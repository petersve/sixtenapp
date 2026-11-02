-- Övningsinspelningar (Pocket) får skriftlig feedback i stället för fem frågor.
alter table public.lectures add column if not exists feedback text;
alter table public.lectures add column if not exists practice_for text; -- modulens slug när inspelningen är en övning
