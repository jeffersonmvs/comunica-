import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

/**
 * Camada SFU (Selective Forwarding Unit) baseada em mediasoup.
 *
 * Evolui a voz ao vivo de "malha P2P" para uma topologia em estrela: o falante
 * envia UM fluxo de áudio ao servidor (Producer); o servidor encaminha para
 * cada ouvinte (Consumers). Assim o falante não precisa de N conexões — escala
 * para dezenas de ouvintes por canal.
 *
 * O `mediasoup` é uma dependência OPCIONAL (compila um worker nativo pesado).
 * Ele é carregado por `import()` dinâmico só quando o SFU está habilitado; se
 * não estiver instalado (ex.: build enxuto do Render) ou o worker não iniciar,
 * `available=false` e o cliente cai automaticamente para a malha P2P.
 * Os tipos do mediasoup são referenciados como `any` para não exigir o pacote
 * em tempo de compilação.
 */
@Injectable()
export class SfuService implements OnModuleDestroy {
  private readonly logger = new Logger('SfuService');
  private worker: any = null;
  private available = false;

  private readonly routers = new Map<string, any>(); // channelId -> Router
  private readonly transports = new Map<string, { transport: any; socketId: string; channelId: string }>();
  private readonly producers = new Map<string, { producer: any; socketId: string; channelId: string }>();
  private readonly consumers = new Map<string, { consumer: any; socketId: string }>();

  private readonly listenIp = process.env.SFU_LISTEN_IP || '127.0.0.1';
  private readonly announcedIp = process.env.SFU_ANNOUNCED_IP || undefined;

  private static readonly AUDIO_CODECS: any[] = [
    { kind: 'audio', mimeType: 'audio/opus', preferredPayloadType: 111, clockRate: 48000, channels: 2 },
  ];

  /** Inicializa o worker sob demanda (lazy) e reporta disponibilidade. */
  async init(): Promise<boolean> {
    // Permite desligar o SFU em ambientes sem UDP (ex.: Render) — o cliente
    // usa a malha P2P automaticamente quando available=false.
    if (process.env.SFU_ENABLED === 'false') {
      this.available = false;
      this.logger.log('SFU desabilitado (SFU_ENABLED=false) — voz ao vivo via malha P2P.');
      return false;
    }
    if (this.worker) return this.available;
    try {
      // import() dinâmico via especificador indireto: o pacote nativo (opcional)
      // só é carregado quando o SFU está ligado, e o tsc não exige o módulo em
      // tempo de compilação (build enxuto do Render funciona sem ele instalado).
      const moduleName = 'mediasoup';
      const mediasoup: any = await import(moduleName);
      this.worker = await mediasoup.createWorker({
        rtcMinPort: Number(process.env.SFU_MIN_PORT || 40000),
        rtcMaxPort: Number(process.env.SFU_MAX_PORT || 40100),
      });
      this.worker.on('died', () => {
        this.logger.error('Worker mediasoup morreu — SFU indisponível.');
        this.available = false;
        this.worker = null;
      });
      this.available = true;
      this.logger.log(`SFU pronto (worker pid ${this.worker.pid}).`);
    } catch (err) {
      this.available = false;
      this.worker = null;
      this.logger.warn(`SFU indisponível (fallback para malha P2P): ${(err as Error).message}`);
    }
    return this.available;
  }

  isAvailable(): boolean {
    return this.available && !!this.worker;
  }

  private async getRouter(channelId: string): Promise<any> {
    let router = this.routers.get(channelId);
    if (router && !router.closed) return router;
    if (!this.worker) throw new Error('SFU indisponível.');
    router = await this.worker.createRouter({ mediaCodecs: SfuService.AUDIO_CODECS });
    this.routers.set(channelId, router);
    return router;
  }

  async getRtpCapabilities(channelId: string): Promise<any> {
    const router = await this.getRouter(channelId);
    return router.rtpCapabilities;
  }

  /** Cria um WebRtcTransport (enviar = falante, receber = ouvinte). */
  async createTransport(channelId: string, socketId: string) {
    const router = await this.getRouter(channelId);
    const transport = await router.createWebRtcTransport({
      listenInfos: [
        { protocol: 'udp', ip: this.listenIp, announcedAddress: this.announcedIp },
        { protocol: 'tcp', ip: this.listenIp, announcedAddress: this.announcedIp },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });
    this.transports.set(transport.id, { transport, socketId, channelId });
    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  }

  async connectTransport(transportId: string, dtlsParameters: any): Promise<void> {
    const entry = this.transports.get(transportId);
    if (!entry) throw new Error('Transport não encontrado.');
    await entry.transport.connect({ dtlsParameters });
  }

  /** Falante publica a faixa de áudio. Retorna o id do Producer. */
  async produce(
    transportId: string,
    kind: any,
    rtpParameters: any,
    socketId: string,
  ): Promise<string> {
    const entry = this.transports.get(transportId);
    if (!entry) throw new Error('Transport não encontrado.');
    const producer = await entry.transport.produce({ kind, rtpParameters });
    this.producers.set(producer.id, { producer, socketId, channelId: entry.channelId });
    return producer.id;
  }

  /** Ouvinte consome o Producer do falante. Consumer inicia pausado. */
  async consume(
    channelId: string,
    transportId: string,
    producerId: string,
    rtpCapabilities: any,
    socketId: string,
  ) {
    const router = await this.getRouter(channelId);
    if (!router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error('Não é possível consumir este producer (capacidades incompatíveis).');
    }
    const entry = this.transports.get(transportId);
    if (!entry) throw new Error('Transport não encontrado.');
    const consumer = await entry.transport.consume({ producerId, rtpCapabilities, paused: true });
    this.consumers.set(consumer.id, { consumer, socketId });
    return {
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    };
  }

  async resumeConsumer(consumerId: string): Promise<void> {
    const entry = this.consumers.get(consumerId);
    if (entry) await entry.consumer.resume();
  }

  /** IDs dos producers ativos de um canal (para o ouvinte que chega). */
  producersOfChannel(channelId: string): string[] {
    return [...this.producers.values()]
      .filter((p) => p.channelId === channelId && !p.producer.closed)
      .map((p) => p.producer.id);
  }

  /** Fecha os producers de um socket (encerrou a fala / desconectou). */
  closeProducersOfSocket(socketId: string): void {
    for (const [id, entry] of [...this.producers.entries()]) {
      if (entry.socketId === socketId) {
        try { entry.producer.close(); } catch { /* noop */ }
        this.producers.delete(id);
      }
    }
  }

  /** Limpeza completa de um socket ao desconectar. */
  cleanupSocket(socketId: string): void {
    this.closeProducersOfSocket(socketId);
    for (const [id, entry] of [...this.consumers.entries()]) {
      if (entry.socketId === socketId) {
        try { entry.consumer.close(); } catch { /* noop */ }
        this.consumers.delete(id);
      }
    }
    for (const [id, entry] of [...this.transports.entries()]) {
      if (entry.socketId === socketId) {
        try { entry.transport.close(); } catch { /* noop */ }
        this.transports.delete(id);
      }
    }
  }

  onModuleDestroy(): void {
    try { this.worker?.close(); } catch { /* noop */ }
  }
}
