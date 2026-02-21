export interface Wordbook {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWordbookInput {
  name: string;
  description?: string | null;
}

export interface UpdateWordbookInput {
  name?: string;
  description?: string | null;
}

export interface WordbookWithCount extends Wordbook {
  wordCount: number;
}
