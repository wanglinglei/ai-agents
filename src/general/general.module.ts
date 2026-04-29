import { Module } from '@nestjs/common';
import { BitifulService } from '../lib/bitifulService';
import { VerificationService } from '../lib/verificationService';
import { GeneralController } from './general.controller';
import { GeneralService } from './general.service';

@Module({
  controllers: [GeneralController],
  providers: [GeneralService, BitifulService, VerificationService],
  exports: [GeneralService],
})
export class GeneralModule {}
