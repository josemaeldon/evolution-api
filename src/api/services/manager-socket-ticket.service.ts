import { Auth, configService } from '@config/env.config';
import { sign, verify } from 'jsonwebtoken';

export type ManagerSocketTicket = {
  companyId: string;
  instanceName: string;
};

export function createManagerSocketTicket(ticket: ManagerSocketTicket, userId: string): string {
  const secret = configService.get<Auth>('AUTHENTICATION').API_KEY.KEY;
  return sign({ ...ticket, purpose: 'manager-socket' }, secret, { subject: userId, expiresIn: '1h' });
}

export function verifyManagerSocketTicket(token: string): ManagerSocketTicket | undefined {
  try {
    const secret = configService.get<Auth>('AUTHENTICATION').API_KEY.KEY;
    const payload = verify(token, secret);
    if (typeof payload === 'string' || payload.purpose !== 'manager-socket') return undefined;
    if (typeof payload.companyId !== 'string' || typeof payload.instanceName !== 'string') return undefined;
    return { companyId: payload.companyId, instanceName: payload.instanceName };
  } catch {
    return undefined;
  }
}
