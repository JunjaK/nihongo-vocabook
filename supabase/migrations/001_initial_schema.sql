-- Words table
create table words (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  term text not null,
  reading text not null,
  meaning text not null,
  part_of_speech text,
  notes text,
  tags text[] default '{}',
  jlpt_level smallint,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Study progress (spaced repetition)
create table study_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  word_id uuid references words(id) on delete cascade not null,
  next_review timestamptz default now(),
  interval_days real default 0,
  ease_factor real default 2.5,
  review_count int default 0,
  last_reviewed_at timestamptz,
  unique (user_id, word_id)
);

-- Indexes
create index idx_words_user_id on words(user_id);
create index idx_words_created_at on words(created_at desc);
create index idx_study_progress_user_id on study_progress(user_id);
create index idx_study_progress_next_review on study_progress(next_review);
create index idx_study_progress_word_id on study_progress(word_id);

-- RLS policies
alter table words enable row level security;
alter table study_progress enable row level security;

create policy "Users can CRUD own words"
  on words for all using (auth.uid() = user_id);

create policy "Users can CRUD own progress"
  on study_progress for all using (auth.uid() = user_id);
