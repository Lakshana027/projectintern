// src/ai/ai.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RiskAnalysisService } from './risk-analysis.service';
import { SmartPrioritizationService } from './smart-prioritization.service';
import { OpenAIService } from './openai.service';

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);

  constructor(
    private prisma: PrismaService,
    private riskAnalysis: RiskAnalysisService,
    private prioritization: SmartPrioritizationService,
    private openai: OpenAIService,
  ) {}

  async analyzeNewProject(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { tasks: true, members: true },
    });

    if (!project) return;

    // Generate initial risk assessment
    const riskScore = await this.riskAnalysis.calculateProjectRisk(project);

    // Generate recommendations
    const recommendations = await this.generateRecommendations(project);

    // Save insights
    await this.prisma.aIInsight.createMany({
      data: [
        {
          type: 'RISK',
          title: 'Initial Risk Assessment',
          description: `Project risk score: ${riskScore}%`,
          score: riskScore,
          projectId: project.id,
        },
        ...recommendations.map(rec => ({
          type: rec.type,
          title: rec.title,
          description: rec.description,
          score: rec.score,
          projectId: project.id,
        })),
      ],
    });

    return { riskScore, recommendations };
  }

  async getProjectInsights(projectId: string) {
    return this.prisma.aIInsight.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  async getRiskAnalysis(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        tasks: { include: { assignee: true, dependencies: true } },
        members: true,
      },
    });

    if (!project) throw new Error('Project not found');

    return this.riskAnalysis.analyzeProjectRisks(project);
  }

  async smartPrioritize(projectId: string) {
    const tasks = await this.prisma.task.findMany({
      where: { projectId, status: { not: 'DONE' } },
      include: { dependencies: true, assignee: true },
    });

    return this.prioritization.prioritizeTasks(tasks);
  }

  async predictCompletion(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        tasks: {
          include: { timeEntries: true },
        },
      },
    });

    if (!project) throw new Error('Project not found');

    const completionDate = await this.predictProjectCompletion(project);
    const confidence = this.calculateConfidence(project);

    return {
      predictedCompletionDate: completionDate,
      confidence,
      currentProgress: this.calculateProgress(project),
      recommendations: await this.generateCompletionRecommendations(project),
    };
  }

  async chatWithProject(projectId: string, query: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        tasks: { include: { assignee: true } },
        members: { include: { user: true } },
        milestones: true,
      },
    });

    if (!project) throw new Error('Project not found');

    const context = this.buildProjectContext(project);
    return this.openai.chat(query, context);
  }

  private async generateRecommendations(project: any) {
    const recommendations = [];

    // Check deadlines
    const upcomingDeadlines = project.tasks.filter(
      t => t.dueDate && new Date(t.dueDate) <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    );

    if (upcomingDeadlines.length > 0) {
      recommendations.push({
        type: 'OPTIMIZATION',
        title: 'Upcoming Deadlines',
        description: `${upcomingDeadlines.length} tasks due within 7 days. Consider resource reallocation.`,
        score: 70,
      });
    }

    // Check workload distribution
    const workloadMap = {};
    project.tasks.forEach(task => {
      if (task.assigneeId) {
        workloadMap[task.assigneeId] = (workloadMap[task.assigneeId] || 0) + 1;
      }
    });

    const maxWorkload = Math.max(...Object.values(workloadMap));
    if (maxWorkload > 8) {
      recommendations.push({
        type: 'RESOURCE',
        title: 'Workload Imbalance',
        description: 'Some team members are overloaded. Consider task redistribution.',
        score: 65,
      });
    }

    return recommendations;
  }

  private async predictProjectCompletion(project: any): Promise<Date> {
    const tasks = project.tasks || [];
    const completedTasks = tasks.filter(t => t.status === 'DONE').length;
    const totalTasks = tasks.length;

    if (totalTasks === 0) return project.endDate;

    const velocity = completedTasks / Math.max(1, Math.ceil((Date.now() - new Date(project.startDate).getTime()) / (7 * 24 * 60 * 60 * 1000)));
    const remainingTasks = totalTasks - completedTasks;
    const weeksNeeded = velocity > 0 ? remainingTasks / velocity : remainingTasks;

    const predictedDate = new Date();
    predictedDate.setDate(predictedDate.getDate() + weeksNeeded * 7);

    return predictedDate;
  }

  private calculateConfidence(project: any): number {
    const tasks = project.tasks || [];
    if (tasks.length === 0) return 100;

    const completedTasks = tasks.filter(t => t.status === 'DONE').length;
    const totalTasks = tasks.length;
    const hasDeadlines = tasks.filter(t => t.dueDate).length;

    let confidence = (completedTasks / totalTasks) * 60;
    confidence += hasDeadlines > 0 ? 20 : 10;
    confidence += project.healthScore > 70 ? 20 : 10;

    return Math.min(100, Math.round(confidence));
  }

  private calculateProgress(project: any): number {
    const tasks = project.tasks || [];
    if (tasks.length === 0) return 0;

    const completedTasks = tasks.filter(t => t.status === 'DONE').length;
    return Math.round((completedTasks / tasks.length) * 100);
  }

  private buildProjectContext(project: any): string {
    return `
      Project: ${project.name}
      Status: ${project.status}
      Priority: ${project.priority}
      Progress: ${this.calculateProgress(project)}%
      Tasks: ${project.tasks?.length || 0}
      Completed: ${project.tasks?.filter(t => t.status === 'DONE').length || 0}
      Team Members: ${project.members?.length || 0}
      Budget: $${project.budget}
    `;
  }

  private async generateCompletionRecommendations(project: any) {
    return this.openai.generateRecommendations(
      `Project ${project.name} has ${project.tasks?.length || 0} tasks. ` +
      `${project.tasks?.filter(t => t.status === 'DONE').length || 0} completed. ` +
      `Health score: ${project.healthScore}%. ` +
      'Provide 3 specific recommendations to ensure on-time completion.',
    );
  }
}