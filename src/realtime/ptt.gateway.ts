import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { UsersService } from '../users/users.service';
import { TransmissionsService } from '../transmissions/transmissions.service';
import { isPriority, Priority, PRIORITY_WEIGHT, Sector, SECTOR_LABELS } from '../common/enums';

interface Presence {
  socketId: string;
  userId: string;
  userName: string;
  sector: Sector;
  channelId: string | null;
}

interface ActiveSpeaker {
  socketId: string;
  userId: string;
  userName: string;
  sector: Sector;
  priority: Priority;
  startedAt: string;
}

/**
 * Gateway de Push-to-Talk. Modela o comportamento de um rádio profissional:
 * presença em tempo real, "quem está transmitindo" por canal e prioridade
 * (emergência 🔴 pode interromper transmissões não críticas). Ao encerrar a
 * fala, a transmissão é persistida (áudio + IA) e difundida ao canal.
 */
@WebSocketGateway({ cors: { origin: '*' } })
export class PttGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger('PttGateway');

  private readonly presence = new Map<string, Presence>();
  private readonly activeByChannel = new Map<string, ActiveSpeaker>();

  constructor(
    private readonly users: UsersService,
    private readonly transmissions: TransmissionsService,
  ) {}

  handleConnection(client: Socket): void {
    this.logger.log(`Conexão: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    const p = this.presence.get(client.id);
    this.presence.delete(client.id);
    // Libera o canal se este socket estava transmitindo.
    if (p?.channelId) {
      const active = this.activeByChannel.get(p.channelId);
      if (active?.socketId === client.id) {
        this.activeByChannel.delete(p.channelId);
        this.server.emit('ptt_ended', { channelId: p.channelId });
      }
    }
    this.broadcastPresence();
  }

  @SubscribeMessage('identify')
  onIdentify(@ConnectedSocket() client: Socket, @MessageBody() body: { userId: string }) {
    const user = this.users.findById(body?.userId);
    if (!user) return { ok: false, error: 'Usuário não encontrado.' };
    this.presence.set(client.id, {
      socketId: client.id,
      userId: user.id,
      userName: user.name,
      sector: user.sector,
      channelId: null,
    });
    this.broadcastPresence();
    return { ok: true, user };
  }

  @SubscribeMessage('join_channel')
  onJoin(@ConnectedSocket() client: Socket, @MessageBody() body: { channelId: string }) {
    const p = this.presence.get(client.id);
    if (!p) return { ok: false, error: 'Identifique-se primeiro.' };
    // Sai do canal anterior.
    if (p.channelId) client.leave(this.room(p.channelId));
    p.channelId = body?.channelId || null;
    if (p.channelId) client.join(this.room(p.channelId));
    this.broadcastPresence();
    const active = p.channelId ? this.activeByChannel.get(p.channelId) || null : null;
    return { ok: true, activeSpeaker: active };
  }

  @SubscribeMessage('ptt_start')
  onPttStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { channelId: string; priority: Priority },
  ) {
    const p = this.presence.get(client.id);
    if (!p) return { ok: false, error: 'Identifique-se primeiro.' };
    const channelId = body?.channelId;
    const priority = isPriority(body?.priority) ? body.priority : Priority.ROTINA;
    if (!channelId) return { ok: false, error: 'Canal não informado.' };

    const current = this.activeByChannel.get(channelId);
    if (current && current.socketId !== client.id) {
      // Canal ocupado. Emergência pode interromper transmissões menos críticas.
      const canInterrupt =
        PRIORITY_WEIGHT[priority] > PRIORITY_WEIGHT[current.priority] &&
        priority === Priority.EMERGENCIA;
      if (!canInterrupt) {
        return {
          ok: false,
          denied: true,
          reason: 'Canal ocupado.',
          activeSpeaker: current,
        };
      }
      // Interrompe o falante atual.
      this.server.to(current.socketId).emit('ptt_interrupted', {
        channelId,
        by: { userName: p.userName, sector: p.sector, priority },
      });
    }

    const active: ActiveSpeaker = {
      socketId: client.id,
      userId: p.userId,
      userName: p.userName,
      sector: p.sector,
      priority,
      startedAt: new Date().toISOString(),
    };
    this.activeByChannel.set(channelId, active);
    this.server.emit('ptt_started', {
      channelId,
      userId: p.userId,
      userName: p.userName,
      sector: p.sector,
      sectorLabel: SECTOR_LABELS[p.sector],
      priority,
      // socket do falante: os ouvintes usam para abrir a conexão WebRTC ao vivo.
      speakerSocketId: client.id,
    });
    return { ok: true, startedAt: active.startedAt, socketId: client.id };
  }

  @SubscribeMessage('ptt_cancel')
  onPttCancel(@ConnectedSocket() client: Socket, @MessageBody() body: { channelId: string }) {
    const channelId = body?.channelId;
    const active = channelId ? this.activeByChannel.get(channelId) : undefined;
    if (active && active.socketId === client.id) {
      this.activeByChannel.delete(channelId);
      this.server.emit('ptt_ended', { channelId });
    }
    return { ok: true };
  }

  @SubscribeMessage('ptt_end')
  onPttEnd(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: {
      channelId: string;
      priority: Priority;
      transcript?: string;
      audioBase64?: string;
      mimeType?: string;
      durationMs?: number;
      startedAt?: string;
    },
  ) {
    const p = this.presence.get(client.id);
    if (!p) return { ok: false, error: 'Identifique-se primeiro.' };
    const channelId = body?.channelId;

    // Libera o canal.
    const active = this.activeByChannel.get(channelId);
    if (active?.socketId === client.id) this.activeByChannel.delete(channelId);
    this.server.emit('ptt_ended', { channelId });

    try {
      const { transmission, occurrence } = this.transmissions.create({
        channelId,
        userId: p.userId,
        priority: body?.priority || active?.priority || Priority.ROTINA,
        transcript: body?.transcript,
        audioBase64: body?.audioBase64,
        mimeType: body?.mimeType,
        durationMs: body?.durationMs,
        startedAt: body?.startedAt || active?.startedAt,
      });
      // Difunde o registro para todos (painel + ouvintes do canal).
      this.server.emit('transmission_created', { transmission, occurrence });
      return { ok: true, transmission, occurrence };
    } catch (err) {
      this.logger.error(`Falha ao registrar transmissão: ${(err as Error).message}`);
      return { ok: false, error: 'Falha ao registrar a transmissão.' };
    }
  }

  // ---------------------------------------------------------------------- //
  // Sinalização WebRTC (voz ao vivo). O servidor atua apenas como signaling
  // server: encaminha offer/answer/ICE entre pares (malha P2P por canal). A
  // mídia trafega direto entre navegadores — latência típica < 300 ms.
  // ---------------------------------------------------------------------- //

  /** Ouvinte anuncia-se ao falante para receber o áudio ao vivo. */
  @SubscribeMessage('webrtc_join')
  onWebrtcJoin(@ConnectedSocket() client: Socket, @MessageBody() body: { to: string }) {
    this.relay('webrtc_join', client, body?.to, {});
  }

  @SubscribeMessage('webrtc_offer')
  onWebrtcOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { to: string; sdp: unknown },
  ) {
    this.relay('webrtc_offer', client, body?.to, { sdp: body?.sdp });
  }

  @SubscribeMessage('webrtc_answer')
  onWebrtcAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { to: string; sdp: unknown },
  ) {
    this.relay('webrtc_answer', client, body?.to, { sdp: body?.sdp });
  }

  @SubscribeMessage('webrtc_ice')
  onWebrtcIce(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { to: string; candidate: unknown },
  ) {
    this.relay('webrtc_ice', client, body?.to, { candidate: body?.candidate });
  }

  /** Encaminha um evento de sinalização a um socket específico, anexando o remetente. */
  private relay(event: string, from: Socket, to: string, payload: Record<string, unknown>) {
    if (!to) return { ok: false };
    this.server.to(to).emit(event, { from: from.id, ...payload });
    return { ok: true };
  }

  private room(channelId: string): string {
    return `chan:${channelId}`;
  }

  private broadcastPresence(): void {
    // Deduplica por usuário (um usuário pode ter múltiplas abas).
    const byUser = new Map<string, { userId: string; userName: string; sector: Sector; channels: Set<string> }>();
    for (const p of this.presence.values()) {
      const entry = byUser.get(p.userId) || {
        userId: p.userId,
        userName: p.userName,
        sector: p.sector,
        channels: new Set<string>(),
      };
      if (p.channelId) entry.channels.add(p.channelId);
      byUser.set(p.userId, entry);
    }
    const online = [...byUser.values()].map((u) => ({
      userId: u.userId,
      userName: u.userName,
      sector: u.sector,
      sectorLabel: SECTOR_LABELS[u.sector],
      channels: [...u.channels],
    }));
    const activeChannels = [...this.activeByChannel.entries()].map(([channelId, a]) => ({
      channelId,
      userName: a.userName,
      sector: a.sector,
      priority: a.priority,
    }));
    this.server.emit('presence', { online, activeChannels });
  }
}
