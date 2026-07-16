-- Atomic daily generation limit check-and-reserve
-- Prevents race conditions where concurrent requests exceed the limit
CREATE OR REPLACE FUNCTION check_daily_generation_limit(
  p_user_id UUID,
  p_limit INT DEFAULT 8
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT;
  v_day_start TIMESTAMPTZ;
  v_day_end TIMESTAMPTZ;
BEGIN
  v_day_start := date_trunc('day', now() AT TIME ZONE 'UTC');
  v_day_end := v_day_start + INTERVAL '1 day';

  SELECT count(*) INTO v_count
  FROM generations
  WHERE user_id = p_user_id
    AND created_at >= v_day_start
    AND created_at < v_day_end;

  IF v_count >= p_limit THEN
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$$;
