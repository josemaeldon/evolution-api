import { authGuard } from '@api/guards/auth.guard';
import { prismaRepository } from '@api/server.module';
import { configService } from '@config/env.config';
import { randomBytes } from 'crypto';
import { Router } from 'express';

type FieldType = 'text' | 'textarea' | 'email' | 'phone' | 'number' | 'date' | 'select' | 'checkbox';
type FormField = { id: string; label: string; type: FieldType; required: boolean; options?: string[] };

const fieldTypes = new Set<FieldType>(['text', 'textarea', 'email', 'phone', 'number', 'date', 'select', 'checkbox']);
const validInviteId = (value: string) => /^[A-Za-z0-9_-]{32}$/.test(value);
const error = (message: string) => ({ error: message });

function parseFields(value: unknown): FormField[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return null;
  const ids = new Set<string>();
  const fields: FormField[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null;
    const field = raw as Record<string, unknown>;
    const id = String(field.id || '');
    const label = String(field.label || '').trim();
    const type = field.type as FieldType;
    if (
      !/^[A-Za-z0-9_-]{1,64}$/.test(id) ||
      ids.has(id) ||
      !label ||
      label.length > 120 ||
      !fieldTypes.has(type) ||
      typeof field.required !== 'boolean'
    )
      return null;
    ids.add(id);
    const options = type === 'select' ? field.options : undefined;
    if (
      type === 'select' &&
      (!Array.isArray(options) ||
        options.length < 2 ||
        options.length > 20 ||
        options.some((option) => typeof option !== 'string' || !option.trim() || option.length > 120) ||
        new Set(options).size !== options.length)
    )
      return null;
    fields.push({
      id,
      label,
      type,
      required: field.required,
      ...(type === 'select' ? { options: options as string[] } : {}),
    });
  }
  return fields;
}

function parseAnswers(fields: FormField[], value: unknown): Record<string, string | boolean> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !fields.some((field) => field.id === key))) return null;
  const answers: Record<string, string | boolean> = {};
  for (const field of fields) {
    const raw = input[field.id];
    if (field.type === 'checkbox') {
      if (raw !== undefined && typeof raw !== 'boolean') return null;
      if (field.required && raw !== true) return null;
      answers[field.id] = raw === true;
      continue;
    }
    if (raw !== undefined && typeof raw !== 'string') return null;
    const text = String(raw || '').trim();
    if (text.length > 4000 || (field.required && !text)) return null;
    if (field.type === 'email' && text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return null;
    if (field.type === 'phone' && text && !/^\+?[\d\s().-]{8,30}$/.test(text)) return null;
    if (field.type === 'number' && text && !Number.isFinite(Number(text))) return null;
    if (field.type === 'date' && text && !isValidBrazilianDate(text)) return null;
    if (field.type === 'select' && text && !field.options?.includes(text)) return null;
    answers[field.id] = text;
  }
  return answers;
}

function isValidBrazilianDate(value: string): boolean {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return false;
  const [, day, month, year] = match.map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export class ChatFormRouter {
  public readonly router = Router();

  constructor() {
    this.router.get('/public/:inviteId', async (req, res) => {
      if (!validInviteId(req.params.inviteId)) return res.status(404).json(error('Formulário não encontrado'));
      const invite = await prismaRepository.chatFormInvite.findUnique({
        where: { id: req.params.inviteId },
        include: { form: true, submission: { select: { id: true } } },
      });
      if (!invite) return res.status(404).json(error('Formulário não encontrado'));
      res.set('Cache-Control', 'no-store');
      return res.json({
        title: invite.form.title,
        description: invite.form.description,
        fields: invite.form.fields,
        submitted: !!invite.submission,
      });
    });

    this.router.post('/public/:inviteId', async (req, res) => {
      if (!validInviteId(req.params.inviteId)) return res.status(404).json(error('Formulário não encontrado'));
      const invite = await prismaRepository.chatFormInvite.findUnique({
        where: { id: req.params.inviteId },
        include: { form: true, submission: { select: { id: true } } },
      });
      if (!invite) return res.status(404).json(error('Formulário não encontrado'));
      if (invite.submission) return res.status(409).json(error('Este formulário já foi respondido'));
      const answers = parseAnswers(invite.form.fields as FormField[], req.body?.answers);
      if (!answers) return res.status(400).json(error('Confira os campos do formulário'));
      try {
        await prismaRepository.chatFormSubmission.create({ data: { inviteId: invite.id, answers } });
      } catch (cause: any) {
        if (cause?.code === 'P2002') return res.status(409).json(error('Este formulário já foi respondido'));
        throw cause;
      }
      return res.status(201).json({ submitted: true });
    });

    this.router.get('/:instanceName', authGuard.apikey, async (req, res) => {
      const instance = await prismaRepository.instance.findUnique({
        where: { name: req.params.instanceName },
        select: { id: true },
      });
      if (!instance) return res.status(404).json(error('Instância não encontrada'));
      const forms = await prismaRepository.chatForm.findMany({
        where: { instanceId: instance.id },
        include: { _count: { select: { invites: true } } },
        orderBy: { createdAt: 'desc' },
      });
      return res.json(forms);
    });

    this.router.post('/:instanceName', authGuard.apikey, async (req, res) => {
      const instance = await prismaRepository.instance.findUnique({
        where: { name: req.params.instanceName },
        select: { id: true },
      });
      if (!instance) return res.status(404).json(error('Instância não encontrada'));
      const title = String(req.body?.title || '').trim();
      const description = String(req.body?.description || '').trim();
      const fields = parseFields(req.body?.fields);
      if (!title || title.length > 120 || description.length > 1000 || !fields)
        return res.status(400).json(error('Informe título e campos válidos'));
      const form = await prismaRepository.chatForm.create({
        data: { instanceId: instance.id, title, description: description || null, fields },
      });
      return res.status(201).json(form);
    });

    this.router.get('/:instanceName/:formId/submissions', authGuard.apikey, async (req, res) => {
      const instance = await prismaRepository.instance.findUnique({
        where: { name: req.params.instanceName },
        select: { id: true },
      });
      if (!instance) return res.status(404).json(error('Instância não encontrada'));
      const form = await prismaRepository.chatForm.findFirst({
        where: { id: req.params.formId, instanceId: instance.id },
      });
      if (!form) return res.status(404).json(error('Formulário não encontrado'));
      const page = Number(req.query.page || 0);
      if (!Number.isInteger(page) || page < 0 || page > 100000) return res.status(400).json(error('Página inválida'));
      const invites = await prismaRepository.chatFormInvite.findMany({
        where: { formId: form.id, submission: { isNot: null } },
        include: { submission: true },
        orderBy: { createdAt: 'desc' },
        skip: page * 50,
        take: 51,
      });
      const pageInvites = invites.slice(0, 50);
      const contacts = await prismaRepository.contact.findMany({
        where: { instanceId: instance.id, remoteJid: { in: pageInvites.map((invite) => invite.remoteJid) } },
        select: { remoteJid: true, pushName: true },
      });
      const names = new Map(contacts.map((contact) => [contact.remoteJid, contact.pushName]));
      return res.json({
        items: pageInvites.map((invite) => ({
          id: invite.submission!.id,
          remoteJid: invite.remoteJid,
          contactName: names.get(invite.remoteJid) || invite.remoteJid.split('@')[0],
          answers: invite.submission!.answers,
          createdAt: invite.submission!.createdAt,
        })),
        hasMore: invites.length > 50,
      });
    });

    this.router.put('/:instanceName/:formId/submissions/:submissionId', authGuard.apikey, async (req, res) => {
      const instance = await prismaRepository.instance.findUnique({
        where: { name: req.params.instanceName },
        select: { id: true },
      });
      if (!instance) return res.status(404).json(error('Instância não encontrada'));
      const submission = await prismaRepository.chatFormSubmission.findFirst({
        where: {
          id: req.params.submissionId,
          invite: { form: { id: req.params.formId, instanceId: instance.id } },
        },
        include: { invite: { include: { form: true } } },
      });
      if (!submission) return res.status(404).json(error('Resposta não encontrada'));
      const answers = parseAnswers(submission.invite.form.fields as FormField[], req.body?.answers);
      if (!answers) return res.status(400).json(error('Confira os campos da resposta'));
      const updated = await prismaRepository.chatFormSubmission.update({
        where: { id: submission.id },
        data: { answers },
      });
      return res.json(updated);
    });

    this.router.delete('/:instanceName/:formId/submissions/:submissionId', authGuard.apikey, async (req, res) => {
      const instance = await prismaRepository.instance.findUnique({
        where: { name: req.params.instanceName },
        select: { id: true },
      });
      if (!instance) return res.status(404).json(error('Instância não encontrada'));
      const submission = await prismaRepository.chatFormSubmission.findFirst({
        where: {
          id: req.params.submissionId,
          invite: { form: { id: req.params.formId, instanceId: instance.id } },
        },
        select: { id: true },
      });
      if (!submission) return res.status(404).json(error('Resposta não encontrada'));
      await prismaRepository.chatFormSubmission.delete({ where: { id: submission.id } });
      return res.status(204).send();
    });

    this.router.post('/:instanceName/:formId/invite', authGuard.apikey, async (req, res) => {
      const instance = await prismaRepository.instance.findUnique({
        where: { name: req.params.instanceName },
        select: { id: true },
      });
      if (!instance) return res.status(404).json(error('Instância não encontrada'));
      const form = await prismaRepository.chatForm.findFirst({
        where: { id: req.params.formId, instanceId: instance.id },
      });
      if (!form) return res.status(404).json(error('Formulário não encontrado'));
      const remoteJid = String(req.body?.remoteJid || '');
      if (!/^\d{8,15}@s\.whatsapp\.net$/.test(remoteJid))
        return res.status(400).json(error('Selecione um contato válido'));
      const baseUrl = configService.get('SERVER').URL || `${req.protocol}://${req.get('host')}`;
      const id = randomBytes(24).toString('base64url');
      const url = new URL(`/manager/form/${id}`, baseUrl);
      if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname))
        return res.status(400).json(error('Configure SERVER_URL com HTTPS para enviar formulários'));
      await prismaRepository.chatFormInvite.create({ data: { id, formId: form.id, remoteJid } });
      return res.status(201).json({ url: url.toString() });
    });
  }
}
