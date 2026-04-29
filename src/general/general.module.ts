import { Module } from '@nestjs/common';
import { CosService } from '../lib/cosService';
import { VerificationService } from '../lib/verificationService';
import { GeneralController } from './general.controller';
import { GeneralService } from './general.service';

@Module({
  controllers: [GeneralController],
  providers: [GeneralService, CosService, VerificationService],
  exports: [GeneralService],
})
export class GeneralModule {}
