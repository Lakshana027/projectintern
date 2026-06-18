// src/projects/projects.service.ts
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto, UpdateProjectDto, ProjectQueryDto } from './dto';
import { AIService } from '../ai/ai.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class ProjectsService {
  constructor(
    private prisma: PrismaService,
    private aiService: AIService,
    private notificationService: NotificationsService,
  ) {}

  async create(userId: string, dto: CreateProjectDto) {
    const project = await this.prisma.project.create({
      data: {
        ...dto,
        ownerId: userId,
        members: {
          create: {
            userId,
            role: 'OWNER',
          },
        },
      },
      include: {
        members: { include: { user: true } },
        tasks: true,
      },
    });

    // Generate AI insights for the new project
    await this.aiService.analyzeNewProject(project.id);

    // Log activity
    await this.prisma.activityLog.create({
      data: {
        action: 'PROJECT_CREATED',
        entity: 'Project',
        entityId: project.id,
        userId,
        projectId: project.id,
        details: { name: project.name },
      },
    });

    return project;
  }

  async findAll(query: ProjectQueryDto) {
    const { status, priority, department, search, page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'desc' } = query;

    const where: any = { isArchived: false };

    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (department) where.department = department;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { clientName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [projects, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        include: {
          members: { include: { user: { select: { id: true, fullName: true, avatar: true, email: true } } } },
          tasks: { select: { id: true, status: true } },
          milestones: true,
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.project.count({ where }),
    ]);

    // Calculate health scores and progress
    const projectsWithMetrics = projects.map(project => ({
      ...project,
      healthScore: this.calculateHealthScore(project),
      progress: this.calculateProgress(project),
    }));

    return {
      data: projectsWithMetrics,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string, userId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        members: { include: { user: { select: { id: true, fullName: true, avatar: true, email: true, role: true } } } },
        tasks: {
          include: {
            assignee: { select: { id: true, fullName: true, avatar: true } },
            subtasks: true,
          },
          orderBy: { position: 'asc' },
        },
        milestones: { orderBy: { dueDate: 'asc' } },
        files: true,
        aiInsights: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    // Check access
    const isMember = project.members.some(m => m.userId === userId);
    if (!isMember) {
      throw new ForbiddenException('You do not have access to this project');
    }

    return {
      ...project,
      healthScore: this.calculateHealthScore(project),
      progress: this.calculateProgress(project),
    };
  }

  async update(id: string, userId: string, dto: UpdateProjectDto) {
    const project = await this.findOne(id, userId);

    const updated = await this.prisma.project.update({
      where: { id },
      data: dto,
      include: {
        members: { include: { user: true } },
        tasks: true,
      },
    });

    // Notify members about the update
    await this.notificationService.notifyProjectUpdate(project.id, userId);

    // Log audit
    await this.prisma.auditLog.create({
      data: {
        action: 'PROJECT_UPDATED',
        entity: 'Project',
        entityId: id,
        userId,
        changes: { before: project, after: updated },
      },
    });

    return updated;
  }

  async delete(id: string, userId: string) {
    const project = await this.findOne(id, userId);

    // Only admin or project owner can delete
    const membership = project.members.find(m => m.userId === userId);
    if (membership?.role !== 'OWNER') {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (user?.role !== 'ADMIN') {
        throw new ForbiddenException('Only project owner or admin can delete projects');
      }
    }

    await this.prisma.project.update({
      where: { id },
      data: { isArchived: true },
    });

    await this.prisma.auditLog.create({
      data: {
        action: 'PROJECT_DELETED',
        entity: 'Project',
        entityId: id,
        userId,
      },
    });

    return { message: 'Project deleted successfully' };
  }

  async getProjectAnalytics(id: string, userId: string) {
    const project = await this.findOne(id, userId);

    const tasksByStatus = await this.prisma.task.groupBy({
      by: ['status'],
      where: { projectId: id },
      _count: true,
    });

    const tasksByPriority = await this.prisma.task.groupBy({
      by: ['priority'],
      where: { projectId: id },
      _count: true,
    });

    const memberProductivity = await Promise.all(
      project.members.map(async (member) => {
        const completedTasks = await this.prisma.task.count({
          where: { projectId: id, assigneeId: member.userId, status: 'DONE' },
        });
        const totalTasks = await this.prisma.task.count({
          where: { projectId: id, assigneeId: member.userId },
        });

        return {
          userId: member.userId,
          name: member.user.fullName,
          completedTasks,
          totalTasks,
          productivity: totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0,
        };
      }),
    );

    return {
      project: { id: project.id, name: project.name },
      tasksByStatus,
      tasksByPriority,
      memberProductivity,
      healthScore: this.calculateHealthScore(project),
      progress: this.calculateProgress(project),
    };
  }

  private calculateHealthScore(project: any): number {
    const tasks = project.tasks || [];
    if (tasks.length === 0) return 100;

    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.status === 'DONE').length;
    const overdueTasks = tasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'DONE').length;

    const progressScore = (completedTasks / totalTasks) * 50;
    const overduePenalty = (overdueTasks / totalTasks) * 30;
    const timeScore = project.endDate ? Math.min(50, Math.max(0, 50 - overduePenalty)) : 50;

    return Math.round(Math.min(100, progressScore + timeScore));
  }

  private calculateProgress(project: any): number {
    const tasks = project.tasks || [];
    if (tasks.length === 0) return 0;

    const completedTasks = tasks.filter(t => t.status === 'DONE').length;
    const inProgressTasks = tasks.filter(t => t.status === 'IN_PROGRESS').length;

    return Math.round(((completedTasks + inProgressTasks * 0.5) / tasks.length) * 100);
  }
}