// src/socket/socket.gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards, Logger } from '@nestjs/common';
import { WsJwtGuard } from './ws-jwt.guard';
import { PrismaService } from '../prisma/prisma.service';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/projectflow',
})
export class SocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private logger = new Logger(SocketGateway.name);
  private onlineUsers = new Map<string, string[]>();

  constructor(private prisma: PrismaService) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token;
      // Verify token and get user
      const user = await this.validateToken(token);
      if (!user) {
        client.disconnect();
        return;
      }

      client.data.user = user;
      this.addOnlineUser(user.id, client.id);

      // Join user to their projects
      const projects = await this.prisma.projectMember.findMany({
        where: { userId: user.id },
      });

      projects.forEach(p => {
        client.join(`project:${p.projectId}`);
      });

      client.join(`user:${user.id}`);
      this.logger.log(`Client connected: ${user.email}`);
    } catch (error) {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const user = client.data.user;
    if (user) {
      this.removeOnlineUser(user.id, client.id);
      this.logger.log(`Client disconnected: ${user.email}`);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('joinProject')
  async handleJoinProject(@ConnectedSocket() client: Socket, @MessageBody() projectId: string) {
    client.join(`project:${projectId}`);
    this.server.to(`project:${projectId}`).emit('userJoined', {
      userId: client.data.user.id,
      name: client.data.user.fullName,
    });
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('leaveProject')
  async handleLeaveProject(@ConnectedSocket() client: Socket, @MessageBody() projectId: string) {
    client.leave(`project:${projectId}`);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('taskUpdate')
  async handleTaskUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { projectId: string; taskId: string; changes: any },
  ) {
    this.server.to(`project:${data.projectId}`).emit('taskUpdated', {
      taskId: data.taskId,
      changes: data.changes,
      updatedBy: client.data.user.id,
      updatedAt: new Date(),
    });
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('chatMessage')
  async handleChatMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { projectId: string; message: string },
  ) {
    const message = {
      id: Date.now().toString(),
      content: data.message,
      userId: client.data.user.id,
      userName: client.data.user.fullName,
      userAvatar: client.data.user.avatar,
      createdAt: new Date(),
    };

    this.server.to(`project:${data.projectId}`).emit('newMessage', message);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('typing')
  async handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { projectId: string; isTyping: boolean },
  ) {
    client.to(`project:${data.projectId}`).emit('userTyping', {
      userId: client.data.user.id,
      userName: client.data.user.fullName,
      isTyping: data.isTyping,
    });
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('notification')
  async handleNotification(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string; notification: any },
  ) {
    this.server.to(`user:${data.userId}`).emit('notification', data.notification);
  }

  // Helper methods
  private addOnlineUser(userId: string, socketId: string) {
    const sockets = this.onlineUsers.get(userId) || [];
    sockets.push(socketId);
    this.onlineUsers.set(userId, sockets);
    this.server.emit('onlineUsers', this.getOnlineUserIds());
  }

  private removeOnlineUser(userId: string, socketId: string) {
    const sockets = this.onlineUsers.get(userId) || [];
    this.onlineUsers.set(userId, sockets.filter(s => s !== socketId));
    if (this.onlineUsers.get(userId)?.length === 0) {
      this.onlineUsers.delete(userId);
    }
    this.server.emit('onlineUsers', this.getOnlineUserIds());
  }

  private getOnlineUserIds(): string[] {
    return Array.from(this.onlineUsers.keys());
  }

  private async validateToken(token: string) {
    // Implement JWT validation
    return null;
  }

  // Notify specific user
  notifyUser(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  // Notify project members
  notifyProject(projectId: string, event: string, data: any) {
    this.server.to(`project:${projectId}`).emit(event, data);
  }
}