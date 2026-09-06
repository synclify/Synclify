export const MAX_CALL_PARTICIPANTS = 4;

export type CallMediaState = {
  micEnabled: boolean;
  cameraEnabled: boolean;
};

export type CallParticipant = CallMediaState & {
  id: string;
  nickname: string;
  joinedAt: number;
};

export type CallState = {
  roomId: string;
  active: boolean;
  participants: CallParticipant[];
  participantCount: number;
  maxParticipants: number;
};

export type CallErrorCode =
  | "full"
  | "not_in_room"
  | "not_in_call"
  | "invalid_target"
  | "invalid_payload";

export type CallJoinResult =
  | {
      ok: true;
      state: CallState;
      existingParticipantIds: string[];
    }
  | {
      ok: false;
      code: CallErrorCode;
      message: string;
    };

type CallSession = {
  roomId: string;
  participants: Map<string, CallParticipant>;
};

export class CallRegistry {
  private readonly sessions = new Map<string, CallSession>();

  getState(roomId: string): CallState {
    const session = this.sessions.get(roomId);
    const participants = session
      ? Array.from(session.participants.values()).sort(
          (a, b) => a.joinedAt - b.joinedAt,
        )
      : [];

    return {
      roomId,
      active: participants.length > 0,
      participants,
      participantCount: participants.length,
      maxParticipants: MAX_CALL_PARTICIPANTS,
    };
  }

  join(
    roomId: string,
    participant: { id: string; nickname: string },
    mediaState: CallMediaState,
  ): CallJoinResult {
    let session = this.sessions.get(roomId);
    if (!session) {
      session = { roomId, participants: new Map() };
      this.sessions.set(roomId, session);
    }

    const existing = session.participants.get(participant.id);
    if (!existing && session.participants.size >= MAX_CALL_PARTICIPANTS) {
      return {
        ok: false,
        code: "full",
        message: `Video call is full (${MAX_CALL_PARTICIPANTS} people max).`,
      };
    }

    const existingParticipantIds = Array.from(session.participants.keys()).filter(
      (id) => id !== participant.id,
    );
    session.participants.set(participant.id, {
      id: participant.id,
      nickname: participant.nickname,
      joinedAt: existing?.joinedAt ?? Date.now(),
      ...mediaState,
    });

    return {
      ok: true,
      state: this.getState(roomId),
      existingParticipantIds,
    };
  }

  updateMediaState(
    roomId: string,
    participantId: string,
    mediaState: CallMediaState,
  ): CallState | null {
    const participant = this.sessions
      .get(roomId)
      ?.participants.get(participantId);
    if (!participant) return null;

    participant.micEnabled = mediaState.micEnabled;
    participant.cameraEnabled = mediaState.cameraEnabled;
    return this.getState(roomId);
  }

  leave(roomId: string, participantId: string): CallState {
    const session = this.sessions.get(roomId);
    if (!session) return this.getState(roomId);

    session.participants.delete(participantId);
    if (session.participants.size === 0) {
      this.sessions.delete(roomId);
    }
    return this.getState(roomId);
  }

  hasParticipant(roomId: string, participantId: string): boolean {
    return (
      this.sessions.get(roomId)?.participants.has(participantId) ?? false
    );
  }

  validateSignal(
    roomId: string,
    senderParticipantId: string,
    targetParticipantId: string,
  ): CallErrorCode | null {
    if (!this.hasParticipant(roomId, senderParticipantId)) {
      return "not_in_call";
    }
    if (
      senderParticipantId === targetParticipantId ||
      !this.hasParticipant(roomId, targetParticipantId)
    ) {
      return "invalid_target";
    }
    return null;
  }
}
