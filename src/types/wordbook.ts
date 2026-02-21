export interface Wordbook {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  isShared: boolean;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWordbookInput {
  name: string;
  description?: string | null;
  isShared?: boolean;
}

export interface UpdateWordbookInput {
  name?: string;
  description?: string | null;
  isShared?: boolean;
}

export interface WordbookWithCount extends Wordbook {
  wordCount: number;
}

export interface SharedWordbookListItem extends WordbookWithCount {
  ownerEmail: string;
  isSubscribed: boolean;
}
