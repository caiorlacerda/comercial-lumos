-- Links de revisão mais curtos: novos tokens passam de 32 caracteres (hex de
-- 16 bytes) para 8 caracteres URL-safe (base64url de 6 bytes = 48 bits de
-- entropia, ~281 trilhões de combinações). Links já existentes continuam
-- válidos — só os novos nascem curtos.
ALTER TABLE public.review_links
  ALTER COLUMN token
  SET DEFAULT rtrim(translate(encode(gen_random_bytes(6), 'base64'), '+/', '-_'), '=');
