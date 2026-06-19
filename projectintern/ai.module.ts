// src/ai/ai.module.ts
import { Module } from '@nestjs/common';
import { AIService } from './ai.service';
import { AIController } from './ai.controller';
import { OpenAIService } from './openai.service';
import { RiskAnalysisService } from './risk-analysis.service';
import { SmartPrioritizationService } from './smart-prioritization.service';
import { MeetingNotesService } from './meeting-notes.service';
import { AIChatbotService } from './chatbot.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [
    AIService,
    OpenAIService,
    RiskAnalysisService,
    SmartPrioritizationService,
    MeetingNotesService,
    AIChatbotService,
  ],
  controllers: [AIController],
  exports: [AIService],
})
export class AIModule {}