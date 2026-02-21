import {
  db,
  type LocalWord,
  type LocalStudyProgress,
  type LocalWordbook,
} from '@/lib/db/dexie';
import { sm2, createInitialProgress } from '@/lib/spaced-repetition';
import type {
  Word,
  CreateWordInput,
  UpdateWordInput,
  StudyProgress,
  WordWithProgress,
  ExportData,
  ImportData,
} from '@/types/word';
import type {
  Wordbook,
  CreateWordbookInput,
  UpdateWordbookInput,
  WordbookWithCount,
  SharedWordbookListItem,
} from '@/types/wordbook';
import type {
  DataRepository,
  WordRepository,
  StudyRepository,
  WordbookRepository,
} from './types';

function localWordToWord(local: LocalWord & { id: number }): Word {
  return {
    id: String(local.id),
    term: local.term,
    reading: local.reading,
    meaning: local.meaning,
    notes: local.notes,
    tags: local.tags,
    jlptLevel: local.jlptLevel,
    priority: ((local as unknown as Record<string, unknown>).priority as number) ?? 2,
    mastered: local.mastered ?? false,
    masteredAt: local.masteredAt ?? null,
    createdAt: local.createdAt,
    updatedAt: local.updatedAt,
  };
}

function localProgressToProgress(
  local: LocalStudyProgress & { id: number },
): StudyProgress {
  return {
    id: String(local.id),
    wordId: String(local.wordId),
    nextReview: local.nextReview,
    intervalDays: local.intervalDays,
    easeFactor: local.easeFactor,
    reviewCount: local.reviewCount,
    lastReviewedAt: local.lastReviewedAt,
  };
}

function localWordbookToWordbook(local: LocalWordbook & { id: number }): Wordbook {
  return {
    id: String(local.id),
    userId: '',
    name: local.name,
    description: local.description,
    isShared: false,
    isSystem: false,
    tags: [],
    createdAt: local.createdAt,
    updatedAt: local.updatedAt,
  };
}

class IndexedDBWordRepository implements WordRepository {
  async getAll(): Promise<Word[]> {
    const words = await db.words.orderBy('createdAt').reverse().toArray();
    return words.map((w) => localWordToWord(w as LocalWord & { id: number }));
  }

  async getNonMastered(): Promise<Word[]> {
    const words = await db.words
      .filter((w) => !w.mastered)
      .toArray();
    return words
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((w) => localWordToWord(w as LocalWord & { id: number }));
  }

  async getMastered(): Promise<Word[]> {
    const words = await db.words
      .filter((w) => w.mastered === true)
      .toArray();
    return words
      .sort((a, b) => {
        const aTime = a.masteredAt?.getTime() ?? 0;
        const bTime = b.masteredAt?.getTime() ?? 0;
        return bTime - aTime;
      })
      .map((w) => localWordToWord(w as LocalWord & { id: number }));
  }

  async getById(id: string): Promise<Word | null> {
    const word = await db.words.get(Number(id));
    if (!word) return null;
    return localWordToWord(word as LocalWord & { id: number });
  }

  async search(query: string): Promise<Word[]> {
    const lower = query.toLowerCase();
    const words = await db.words
      .filter(
        (w) =>
          w.term.toLowerCase().includes(lower) ||
          w.reading.toLowerCase().includes(lower) ||
          w.meaning.toLowerCase().includes(lower),
      )
      .toArray();
    return words.map((w) => localWordToWord(w as LocalWord & { id: number }));
  }

  async create(input: CreateWordInput): Promise<Word> {
    const now = new Date();
    const localWord: LocalWord = {
      term: input.term,
      reading: input.reading,
      meaning: input.meaning,
      notes: input.notes ?? null,
      tags: input.tags ?? [],
      jlptLevel: input.jlptLevel ?? null,
      mastered: false,
      masteredAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const id = await db.words.add(localWord);
    return localWordToWord({ ...localWord, id: id as number });
  }

  async update(id: string, input: UpdateWordInput): Promise<Word> {
    const numId = Number(id);
    await db.words.update(numId, { ...input, updatedAt: new Date() });
    const updated = await db.words.get(numId);
    if (!updated) throw new Error('Word not found');
    return localWordToWord(updated as LocalWord & { id: number });
  }

  async delete(id: string): Promise<void> {
    const numId = Number(id);
    await db.studyProgress.where('wordId').equals(numId).delete();
    await db.wordbookItems.where('wordId').equals(numId).delete();
    await db.words.delete(numId);
  }

  async setMastered(id: string, mastered: boolean): Promise<Word> {
    const numId = Number(id);
    const now = new Date();
    await db.words.update(numId, {
      mastered,
      masteredAt: mastered ? now : null,
      updatedAt: now,
    });
    if (mastered) {
      await db.wordbookItems.where('wordId').equals(numId).delete();
    }
    const updated = await db.words.get(numId);
    if (!updated) throw new Error('Word not found');
    return localWordToWord(updated as LocalWord & { id: number });
  }
}

class IndexedDBStudyRepository implements StudyRepository {
  async getProgress(wordId: string): Promise<StudyProgress | null> {
    const progress = await db.studyProgress
      .where('wordId')
      .equals(Number(wordId))
      .first();
    if (!progress) return null;
    return localProgressToProgress(
      progress as LocalStudyProgress & { id: number },
    );
  }

  async getDueWords(limit = 20): Promise<WordWithProgress[]> {
    const now = new Date();
    const allWords = await db.words
      .filter((w) => !w.mastered)
      .toArray();
    const result: WordWithProgress[] = [];

    for (const word of allWords) {
      const w = word as LocalWord & { id: number };
      const progress = await db.studyProgress
        .where('wordId')
        .equals(w.id)
        .first();

      if (!progress || progress.nextReview <= now) {
        result.push({
          ...localWordToWord(w),
          progress: progress
            ? localProgressToProgress(
                progress as LocalStudyProgress & { id: number },
              )
            : null,
        });
      }
      if (result.length >= limit) break;
    }

    return result;
  }

  async recordReview(wordId: string, quality: number): Promise<void> {
    const numWordId = Number(wordId);
    const existing = await db.studyProgress
      .where('wordId')
      .equals(numWordId)
      .first();

    if (existing) {
      const current = localProgressToProgress(
        existing as LocalStudyProgress & { id: number },
      );
      const updated = sm2(quality, current);
      await db.studyProgress.update(existing.id!, {
        nextReview: updated.nextReview,
        intervalDays: updated.intervalDays,
        easeFactor: updated.easeFactor,
        reviewCount: updated.reviewCount,
        lastReviewedAt: updated.lastReviewedAt,
      });
    } else {
      const initial = createInitialProgress(wordId);
      const updated = sm2(quality, initial);
      await db.studyProgress.add({
        wordId: numWordId,
        nextReview: updated.nextReview,
        intervalDays: updated.intervalDays,
        easeFactor: updated.easeFactor,
        reviewCount: updated.reviewCount,
        lastReviewedAt: updated.lastReviewedAt,
      });
    }
  }
}

class IndexedDBWordbookRepository implements WordbookRepository {
  async getAll(): Promise<WordbookWithCount[]> {
    const wordbooks = await db.wordbooks.orderBy('createdAt').reverse().toArray();
    const result: WordbookWithCount[] = [];
    for (const wb of wordbooks) {
      const typedWb = wb as LocalWordbook & { id: number };
      const wordCount = await db.wordbookItems
        .where('wordbookId')
        .equals(typedWb.id)
        .count();
      result.push({ ...localWordbookToWordbook(typedWb), wordCount, importCount: 0 });
    }
    return result;
  }

  async getById(id: string): Promise<Wordbook | null> {
    const wb = await db.wordbooks.get(Number(id));
    if (!wb) return null;
    return localWordbookToWordbook(wb as LocalWordbook & { id: number });
  }

  async create(input: CreateWordbookInput): Promise<Wordbook> {
    const now = new Date();
    const local: LocalWordbook = {
      name: input.name,
      description: input.description ?? null,
      createdAt: now,
      updatedAt: now,
    };
    const id = await db.wordbooks.add(local);
    return localWordbookToWordbook({ ...local, id: id as number });
  }

  async update(id: string, input: UpdateWordbookInput): Promise<Wordbook> {
    const numId = Number(id);
    const updateData: Partial<LocalWordbook> = { updatedAt: new Date() };
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    await db.wordbooks.update(numId, updateData);
    const updated = await db.wordbooks.get(numId);
    if (!updated) throw new Error('Wordbook not found');
    return localWordbookToWordbook(updated as LocalWordbook & { id: number });
  }

  async delete(id: string): Promise<void> {
    const numId = Number(id);
    await db.wordbookItems.where('wordbookId').equals(numId).delete();
    await db.wordbooks.delete(numId);
  }

  async getWords(wordbookId: string): Promise<Word[]> {
    const numId = Number(wordbookId);
    const items = await db.wordbookItems
      .where('wordbookId')
      .equals(numId)
      .toArray();
    const words: Word[] = [];
    for (const item of items) {
      const word = await db.words.get(item.wordId);
      if (word) {
        words.push(localWordToWord(word as LocalWord & { id: number }));
      }
    }
    return words;
  }

  async addWord(wordbookId: string, wordId: string): Promise<void> {
    const word = await db.words.get(Number(wordId));
    if (!word) throw new Error('Word not found');
    if (word.mastered) throw new Error('Cannot add mastered word to wordbook');

    const existing = await db.wordbookItems
      .where('[wordbookId+wordId]')
      .equals([Number(wordbookId), Number(wordId)])
      .first();
    if (existing) return;

    await db.wordbookItems.add({
      wordbookId: Number(wordbookId),
      wordId: Number(wordId),
    });
  }

  async removeWord(wordbookId: string, wordId: string): Promise<void> {
    await db.wordbookItems
      .where('[wordbookId+wordId]')
      .equals([Number(wordbookId), Number(wordId)])
      .delete();
  }

  async getWordbooksForWord(wordId: string): Promise<Wordbook[]> {
    const items = await db.wordbookItems
      .where('wordId')
      .equals(Number(wordId))
      .toArray();
    const wordbooks: Wordbook[] = [];
    for (const item of items) {
      const wb = await db.wordbooks.get(item.wordbookId);
      if (wb) {
        wordbooks.push(localWordbookToWordbook(wb as LocalWordbook & { id: number }));
      }
    }
    return wordbooks;
  }

  // Shared features not available in guest mode
  async getSubscribed(): Promise<WordbookWithCount[]> {
    return [];
  }

  async browseShared(): Promise<SharedWordbookListItem[]> {
    return [];
  }

  async subscribe(): Promise<void> {
    throw new Error('Sign in required to subscribe to shared wordbooks');
  }

  async unsubscribe(): Promise<void> {
    throw new Error('Sign in required to unsubscribe from shared wordbooks');
  }

  async copySharedWordbook(): Promise<Wordbook> {
    throw new Error('Sign in required to copy shared wordbooks');
  }
}

export class IndexedDBRepository implements DataRepository {
  words = new IndexedDBWordRepository();
  study = new IndexedDBStudyRepository();
  wordbooks = new IndexedDBWordbookRepository();

  async exportAll(): Promise<ExportData> {
    const words = await this.words.getAll();
    const studyProgress: StudyProgress[] = [];
    for (const word of words) {
      const progress = await this.study.getProgress(word.id);
      if (progress) studyProgress.push(progress);
    }

    const allWordbooks = await db.wordbooks.toArray();
    const wordbooks = allWordbooks.map((wb) => {
      const typedWb = wb as LocalWordbook & { id: number };
      return {
        id: String(typedWb.id),
        name: typedWb.name,
        description: typedWb.description,
        createdAt: typedWb.createdAt.toISOString(),
        updatedAt: typedWb.updatedAt.toISOString(),
      };
    });

    const allItems = await db.wordbookItems.toArray();
    const wordbookItems = allItems.map((item) => ({
      wordbookId: String(item.wordbookId),
      wordId: String(item.wordId),
      addedAt: new Date().toISOString(),
    }));

    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      words,
      studyProgress,
      wordbooks,
      wordbookItems,
    };
  }

  async importAll(data: ImportData): Promise<void> {
    await db.transaction(
      'rw',
      db.words,
      db.studyProgress,
      db.wordbooks,
      db.wordbookItems,
      async () => {
        const wordIdMap = new Map<string, number>();

        for (const word of data.words) {
          const id = await db.words.add({
            term: word.term,
            reading: word.reading,
            meaning: word.meaning,
            notes: word.notes,
            tags: word.tags,
            jlptLevel: word.jlptLevel,
            mastered: word.mastered ?? false,
            masteredAt: word.masteredAt ? new Date(word.masteredAt) : null,
            createdAt: new Date(word.createdAt),
            updatedAt: new Date(word.updatedAt),
          });
          wordIdMap.set(word.id, id as number);

          const progress = data.studyProgress.find((p) => p.wordId === word.id);
          if (progress) {
            await db.studyProgress.add({
              wordId: id as number,
              nextReview: new Date(progress.nextReview),
              intervalDays: progress.intervalDays,
              easeFactor: progress.easeFactor,
              reviewCount: progress.reviewCount,
              lastReviewedAt: progress.lastReviewedAt
                ? new Date(progress.lastReviewedAt)
                : null,
            });
          }
        }

        if (data.version === 2) {
          const wordbookIdMap = new Map<string, number>();
          for (const wb of data.wordbooks) {
            const id = await db.wordbooks.add({
              name: wb.name,
              description: wb.description,
              createdAt: new Date(wb.createdAt),
              updatedAt: new Date(wb.updatedAt),
            });
            wordbookIdMap.set(wb.id, id as number);
          }

          for (const item of data.wordbookItems) {
            const wordbookId = wordbookIdMap.get(item.wordbookId);
            const wordId = wordIdMap.get(item.wordId);
            if (wordbookId && wordId) {
              await db.wordbookItems.add({ wordbookId, wordId });
            }
          }
        }
      },
    );
  }
}
