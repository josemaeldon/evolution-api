import { RouterBroker } from '@api/abstract/abstract.router';
import {
  SendAudioDto,
  SendButtonsDto,
  SendContactDto,
  SendFlowDto,
  SendListDto,
  SendLocationDto,
  SendMediaDto,
  SendPollDto,
  SendPtvDto,
  SendReactionDto,
  SendStatusDto,
  SendStickerDto,
  SendTemplateDto,
  SendTextDto,
} from '@api/dto/sendMessage.dto';
import { sendMessageController } from '@api/server.module';
import {
  managerSender,
  recordManagerRequest,
  recordManagerSender,
  runIdempotentSend,
  signedText,
} from '@api/services/manager-message.service';
import {
  audioMessageSchema,
  buttonsMessageSchema,
  contactMessageSchema,
  flowMessageSchema,
  listMessageSchema,
  locationMessageSchema,
  mediaMessageSchema,
  pollMessageSchema,
  ptvMessageSchema,
  reactionMessageSchema,
  statusMessageSchema,
  stickerMessageSchema,
  templateMessageSchema,
  textMessageSchema,
} from '@validate/validate.schema';
import { RequestHandler, Router } from 'express';
import multer from 'multer';

import { HttpStatus } from './index.router';

const upload = multer({ storage: multer.memoryStorage() });

export class MessageRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();
    this.router
      .post(this.routerPath('sendTemplate'), ...guards, async (req, res) => {
        const response = await this.dataValidate<SendTemplateDto>({
          request: req,
          schema: templateMessageSchema,
          ClassRef: SendTemplateDto,
          execute: (instance, data) => sendMessageController.sendTemplate(instance, data),
        });

        return res.status(HttpStatus.CREATED).json(await recordManagerRequest(req, response));
      })
      .post(this.routerPath('sendText'), ...guards, async (req, res) => {
        const response = await runIdempotentSend(req, async () => {
          const sender = await managerSender(req);
          const signed = !!sender?.signMessages;
          const sent = await this.dataValidate<SendTextDto>({
            request: req,
            schema: textMessageSchema,
            ClassRef: SendTextDto,
            execute: (instance, data) =>
              sendMessageController.sendText(instance, {
                ...data,
                text: signed ? signedText(sender.name, data.text) : data.text,
              }),
          });
          return recordManagerSender(req.params.instanceName, sent, sender, signed);
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendMedia'), ...guards, upload.single('file'), async (req, res) => {
        const response = await runIdempotentSend(req, async () => {
          const sender = await managerSender(req);
          const signed = !!sender?.signMessages && ['image', 'video', 'document'].includes(req.body?.mediatype);
          const bodyData = req.body;
          if (signed) bodyData.caption = signedText(sender.name, String(bodyData.caption || ''));

          const sent = await this.dataValidate<SendMediaDto>({
            request: req,
            schema: mediaMessageSchema,
            ClassRef: SendMediaDto,
            execute: (instance) => sendMessageController.sendMedia(instance, bodyData, req.file as any),
          });
          return recordManagerSender(req.params.instanceName, sent, sender, signed);
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendPtv'), ...guards, upload.single('file'), async (req, res) => {
        const bodyData = req.body;

        const response = await this.dataValidate<SendPtvDto>({
          request: req,
          schema: ptvMessageSchema,
          ClassRef: SendPtvDto,
          execute: (instance) => sendMessageController.sendPtv(instance, bodyData, req.file as any),
        });

        return res.status(HttpStatus.CREATED).json(await recordManagerRequest(req, response));
      })
      .post(this.routerPath('sendWhatsAppAudio'), ...guards, upload.single('file'), async (req, res) => {
        const response = await runIdempotentSend(req, async () => {
          const sender = await managerSender(req);
          const sent = await this.dataValidate<SendAudioDto>({
            request: req,
            schema: audioMessageSchema,
            ClassRef: SendMediaDto,
            execute: (instance) => sendMessageController.sendWhatsAppAudio(instance, req.body, req.file as any),
          });
          return recordManagerSender(req.params.instanceName, sent, sender, false);
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      // TODO: Revisar funcionamento do envio de Status
      .post(this.routerPath('sendStatus'), ...guards, upload.single('file'), async (req, res) => {
        const bodyData = req.body;

        const response = await this.dataValidate<SendStatusDto>({
          request: req,
          schema: statusMessageSchema,
          ClassRef: SendStatusDto,
          execute: (instance) => sendMessageController.sendStatus(instance, bodyData, req.file as any),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendSticker'), ...guards, upload.single('file'), async (req, res) => {
        const bodyData = req.body;

        const response = await this.dataValidate<SendStickerDto>({
          request: req,
          schema: stickerMessageSchema,
          ClassRef: SendStickerDto,
          execute: (instance) => sendMessageController.sendSticker(instance, bodyData, req.file as any),
        });

        return res.status(HttpStatus.CREATED).json(await recordManagerRequest(req, response));
      })
      .post(this.routerPath('sendLocation'), ...guards, async (req, res) => {
        const response = await this.dataValidate<SendLocationDto>({
          request: req,
          schema: locationMessageSchema,
          ClassRef: SendLocationDto,
          execute: (instance, data) => sendMessageController.sendLocation(instance, data),
        });

        return res.status(HttpStatus.CREATED).json(await recordManagerRequest(req, response));
      })
      .post(this.routerPath('sendContact'), ...guards, async (req, res) => {
        const response = await this.dataValidate<SendContactDto>({
          request: req,
          schema: contactMessageSchema,
          ClassRef: SendContactDto,
          execute: (instance, data) => sendMessageController.sendContact(instance, data),
        });

        return res.status(HttpStatus.CREATED).json(await recordManagerRequest(req, response));
      })
      .post(this.routerPath('sendReaction'), ...guards, async (req, res) => {
        const response = await this.dataValidate<SendReactionDto>({
          request: req,
          schema: reactionMessageSchema,
          ClassRef: SendReactionDto,
          execute: (instance, data) => sendMessageController.sendReaction(instance, data),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendPoll'), ...guards, async (req, res) => {
        const response = await runIdempotentSend(req, async () => {
          const sent = await this.dataValidate<SendPollDto>({
            request: req,
            schema: pollMessageSchema,
            ClassRef: SendPollDto,
            execute: (instance, data) => sendMessageController.sendPoll(instance, data),
          });
          return recordManagerRequest(req, sent);
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendFlow'), ...guards, async (req, res) => {
        const response = await runIdempotentSend(req, async () => {
          const sent = await this.dataValidate<SendFlowDto>({
            request: req,
            schema: flowMessageSchema,
            ClassRef: SendFlowDto,
            execute: (instance, data) => sendMessageController.sendFlow(instance, data),
          });
          return recordManagerRequest(req, sent);
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendList'), ...guards, async (req, res) => {
        const response = await runIdempotentSend(req, async () => {
          const sent = await this.dataValidate<SendListDto>({
            request: req,
            schema: listMessageSchema,
            ClassRef: SendListDto,
            execute: (instance, data) => sendMessageController.sendList(instance, data),
          });
          return recordManagerRequest(req, sent);
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendButtons'), ...guards, async (req, res) => {
        const response = await runIdempotentSend(req, async () => {
          const sent = await this.dataValidate<SendButtonsDto>({
            request: req,
            schema: buttonsMessageSchema,
            ClassRef: SendButtonsDto,
            execute: (instance, data) => sendMessageController.sendButtons(instance, data),
          });
          return recordManagerRequest(req, sent);
        });

        return res.status(HttpStatus.CREATED).json(response);
      });
  }

  public readonly router: Router = Router();
}
