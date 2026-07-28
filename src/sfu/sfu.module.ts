import { Global, Module, OnModuleInit } from '@nestjs/common';
import { SfuService } from './sfu.service';

@Global()
@Module({
  providers: [SfuService],
  exports: [SfuService],
})
export class SfuModule implements OnModuleInit {
  constructor(private readonly sfu: SfuService) {}

  /** Tenta iniciar o worker no boot; falha vira fallback automático. */
  async onModuleInit(): Promise<void> {
    await this.sfu.init();
  }
}
