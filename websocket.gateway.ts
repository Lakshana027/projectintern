import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
  namespace: '/projectflow',
})
export class ProjectFlowGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ProjectFlowGateway.name);
  private connectedUsers: Map<string, Set<string>> = new Map();
  private userSockets: Map<string, string> = new Map();

  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token || client.handshake.query.token;
      
      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET,
      });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        include: { teamMemberships: true },
      });

      if (!user) {
        client.disconnect();
        return;
      }

      // Store user connection
      client.data.userId = user.id;
      client.data.user = user;
      this.userSockets.set(user.id, client.id);

      // Join user's teams rooms
      user.teamMemberships.forEach(membership => {
        if (membership.projectId) {
          client.join(`project:${membership.projectId}`);
        }
        client.join(`team:${membership.teamId}`);
      });

      // Join user's personal room
      client.join(`user:${user.id}`);

      // Track connected users per project
      this.trackUserConnection(client);

      this.logger.log(`Client connected: ${user.email} (${user.id})`);

      // Broadcast user online status
      this.server.emit('user:online', {
        userId: user.id,
        fullName: user.fullName,
        timestamp: new Date(),
      });

      // Send initial data
      client.emit('connection:established', {
        userId: user.id,
        message: 'Connected to ProjectFlow WebSocket',
        timestamp: new Date(),
      });

    } catch (error) {
      this.logger.error('Connection error:', error);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId;
    
    if (userId) {
      this.userSockets.delete(userId);
      
      // Remove from connected users tracking
      this.connectedUsers.forEach((users, projectId) => {
        users.delete(userId);
        if (users.size === 0) {
          this.connectedUsers.delete(projectId);
        }
      });

      this.server.emit('user:offline', {
        userId,
        timestamp: new Date(),
      });

      this.logger.log(`Client disconnected: ${userId}`);
    }
  }

  @SubscribeMessage('project:join')
  handleProjectJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { projectId: string },
  ) {
    client.join(`project:${data.projectId}`);
    this.trackUserConnection(client, data.projectId);
    
    // Notify others in the project
    client.to(`project:${data.projectId}`).emit('project:userJoined', {
      userId: client.data.userId,
      fullName: client.data.user.fullName,
      projectId: data.projectId,
      timestamp: new Date(),
    });
  }

  @SubscribeMessage('project:leave')
  handleProjectLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { projectId: string },
  ) {
    client.leave(`project:${data.projectId}`);
    
    const projectUsers = this.connectedUsers.get(data.projectId);
    if (projectUsers) {
      projectUsers.delete(client.data.userId);
    }
  }

  @SubscribeMessage('task:update')
  async handleTaskUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { taskId: string; projectId: string; updates: any },
  ) {
    try {
      // Update task in database
      const updatedTask = await this.prisma.task.update({
        where: { id: data.taskId },
        data: data.updates,
        include: {
          assignee: true,
          project: true,
        },
      });

      // Create activity log
      await this.prisma.activityLog.create({
        data: {
          action: 'TASK_UPDATED',
          entity: 'Task',
          entityId: data.taskId,
          userId: client.data.userId,
          projectId: data.projectId,
          details: data.updates,
        },
      });

      // Notify all project members
      this.server.to(`project:${data.projectId}`).emit('task:updated', {
        task: updatedTask,
        updatedBy: client.data.user,
        timestamp: new Date(),
      });

      // Notify assignee if changed
      if (data.updates.assigneeId) {
        this.server.to(`user:${data.updates.assigneeId}`).emit('notification', {
          type: 'TASK_ASSIGNED',
          title: 'New Task Assignment',
          message: `You have been assigned to task: ${updatedTask.title}`,
          taskId: updatedTask.id,
          projectId: data.projectId,
        });
      }
    } catch (error) {
      client.emit('error', {
        message: 'Failed to update task',
        error: error.message,
      });
    }
  }

  @SubscribeMessage('task:comment')
  async handleTaskComment(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: {
      taskId: string;
      projectId: string;
      content: string;
      mentions: string[];
    },
  ) {
    try {
      const comment = await this.prisma.comment.create({
        data: {
          content: data.content,
          mentions: data.mentions,
          taskId: data.taskId,
          userId: client.data.userId,
        },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              profilePhoto: true,
            },
          },
        },
      });

      // Broadcast to project
      this.server.to(`project:${data.projectId}`).emit('task:newComment', {
        comment,
        taskId: data.taskId,
      });

      // Notify mentioned users
      if (data.mentions?.length > 0) {
        data.mentions.forEach(userId => {
          this.server.to(`user:${userId}`).emit('notification', {
            type: 'MENTION',
            title: 'You were mentioned',
            message: `${client.data.user.fullName} mentioned you in a comment`,
            taskId: data.taskId,
            projectId: data.projectId,
          });
        });
      }
    } catch (error) {
      client.emit('error', {
        message: 'Failed to add comment',
        error: error.message,
      });
    }
  }

  @SubscribeMessage('typing:start')
  handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { projectId: string; location: string },
  ) {
    client.to(`project:${data.projectId}`).emit('typing:started', {
      userId: client.data.userId,
      fullName: client.data.user.fullName,
      location: data.location,
    });
  }

  @SubscribeMessage('typing:stop')
  handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { projectId: string },
  ) {
    client.to(`project:${data.projectId}`).emit('typing:stopped', {
      userId: client.data.userId,
    });
  }

  @SubscribeMessage('chat:message')
  async handleChatMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: {
      projectId: string;
      message: string;
      attachments?: any[];
    },
  ) {
    const message = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      userId: client.data.userId,
      user: {
        id: client.data.user.id,
        fullName: client.data.user.fullName,
        profilePhoto: client.data.user.profilePhoto,
      },
      message: data.message,
      attachments: data.attachments || [],
      timestamp: new Date(),
    };

    this.server.to(`project:${data.projectId}`).emit('chat:message', message);
  }

  private trackUserConnection(client: Socket, projectId?: string) {
    if (projectId) {
      if (!this.connectedUsers.has(projectId)) {
        this.connectedUsers.set(projectId, new Set());
      }
      this.connectedUsers.get(projectId).add(client.data.userId);

      // Broadcast active users count
      this.server.to(`project:${projectId}`).emit('project:activeUsers', {
        count: this.connectedUsers.get(projectId).size,
        users: Array.from(this.connectedUsers.get(projectId)),
      });
    }
  }
}