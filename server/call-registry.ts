export const MAX_CALL_PARTICIPANTS = 4;
export const MAX_PARTICIPANTS_WHILE_SCREEN_SHARING = 3;

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
  screenShare: ScreenShareState;
};

export type ScreenShareState = {
  active: boolean;
  participantId: string | null;
  startedAt: number | null;
  maxParticipants: number;
};

export type CallErrorCode =
  | "full"
  | "not_in_room"
  | "not_in_call"
  | "invalid_target"
  | "invalid_payload"
  | "screen_share_limit"
  | "screen_share_in_progress"
  | "screen_share_not_owner";

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
  screenShareParticipantId: string | null;
  screenShareStartedAt: number | null;
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
      screenShare: {
        active: !!session?.screenShareParticipantId,
        participantId: session?.screenShareParticipantId ?? null,
        startedAt: session?.screenShareStartedAt ?? null,
        maxParticipants: MAX_PARTICIPANTS_WHILE_SCREEN_SHARING,
      },
    };
  }

  join(
    roomId: string,
    participant: { id: string; nickname: string },
    mediaState: CallMediaState,
  ): CallJoinResult {
    let session = this.sessions.get(roomId);
    if (!session) {
      session = {
        roomId,
        participants: new Map(),
        screenShareParticipantId: null,
        screenShareStartedAt: null,
      };
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

    if (
      !existing &&
      session.screenShareParticipantId &&
      session.participants.size >= MAX_PARTICIPANTS_WHILE_SCREEN_SHARING
    ) {
      return {
        ok: false,
        code: "screen_share_limit",
        message: `Screen sharing is available for calls with up to ${MAX_PARTICIPANTS_WHILE_SCREEN_SHARING} people.`,
      };
    }

    const existingParticipantIds = Array.from(
      session.participants.keys(),
    ).filter((id) => id !== participant.id);
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
    if (session.screenShareParticipantId === participantId) {
      session.screenShareParticipantId = null;
      session.screenShareStartedAt = null;
    }
    if (session.participants.size === 0) {
      this.sessions.delete(roomId);
    }
    return this.getState(roomId);
  }

  startScreenShare(
    roomId: string,
    participantId: string,
    now = Date.now(),
  ):
    | { ok: true; state: CallState }
    | { ok: false; code: CallErrorCode; message: string } {
    const session = this.sessions.get(roomId);
    if (!session?.participants.has(participantId)) {
      return {
        ok: false,
        code: "not_in_call",
        message: "Join the video call before sharing your screen.",
      };
    }
    if (session.participants.size > MAX_PARTICIPANTS_WHILE_SCREEN_SHARING) {
      return {
        ok: false,
        code: "screen_share_limit",
        message: `Screen sharing is available for calls with up to ${MAX_PARTICIPANTS_WHILE_SCREEN_SHARING} people.`,
      };
    }
    if (
      session.screenShareParticipantId &&
      session.screenShareParticipantId !== participantId
    ) {
      return {
        ok: false,
        code: "screen_share_in_progress",
        message: "Someone else is already sharing their screen.",
      };
    }

    session.screenShareParticipantId = participantId;
    session.screenShareStartedAt ??= now;
    return { ok: true, state: this.getState(roomId) };
  }

  stopScreenShare(
    roomId: string,
    participantId: string,
  ):
    | { ok: true; state: CallState }
    | { ok: false; code: CallErrorCode; message: string } {
    const session = this.sessions.get(roomId);
    if (!session?.participants.has(participantId)) {
      return {
        ok: false,
        code: "not_in_call",
        message: "Join the video call before changing screen sharing.",
      };
    }
    if (
      session.screenShareParticipantId &&
      session.screenShareParticipantId !== participantId
    ) {
      return {
        ok: false,
        code: "screen_share_not_owner",
        message: "Only the person sharing can stop this screen share.",
      };
    }

    session.screenShareParticipantId = null;
    session.screenShareStartedAt = null;
    return { ok: true, state: this.getState(roomId) };
  }

  hasParticipant(roomId: string, participantId: string): boolean {
    return this.sessions.get(roomId)?.participants.has(participantId) ?? false;
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
