-- Drop OCR LLM provider settings: replaced by on-device Gemma 4 inference.
alter table public.user_settings
  drop column if exists llm_provider,
  drop column if exists encrypted_api_key;
