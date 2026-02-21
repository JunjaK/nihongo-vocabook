export interface Wordbook {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  isShared: boolean;
  isSystem: boolean;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWordbookInput {
  name: string;
  description?: string | null;
  isShared?: boolean;
  tags?: string[];
}

export interface UpdateWordbookInput {
  name?: string;
  description?: string | null;
  isShared?: boolean;
  tags?: string[];
}

export interface WordbookWithCount extends Wordbook {
  wordCount: number;
  importCount: number;
}

export interface SharedWordbookListItem extends WordbookWithCount {
  ownerEmail: string;
  isSubscribed: boolean;
}
