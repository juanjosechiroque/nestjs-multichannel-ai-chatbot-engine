export abstract class ChatTurnError extends Error {}

export class ChatTurnInProgressError extends ChatTurnError {
  constructor(readonly messageId: string) {
    super(`Message ${messageId} is already being processed`);
    this.name = ChatTurnInProgressError.name;
  }
}

export class ChatTurnMessageConflictError extends ChatTurnError {
  constructor(readonly messageId: string) {
    super(`Message ${messageId} was already used with different content`);
    this.name = ChatTurnMessageConflictError.name;
  }
}

export class ChatTurnPreviouslyFailedError extends ChatTurnError {
  constructor(readonly messageId: string) {
    super(`Message ${messageId} was already processed unsuccessfully`);
    this.name = ChatTurnPreviouslyFailedError.name;
  }
}
