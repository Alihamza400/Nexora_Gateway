-- UP
-- Durable job queue (ADR-002).
--
-- Replaces in-process setTimeout retries, which are lost on deploy, crash or node
-- drain. Living in Postgres rather than Redis is deliberate: a job can be
-- enqueued in the SAME transaction as the state change that caused it, so the
-- queue and the payment intent state machine cannot disagree.
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue VARCHAR(64) NOT NULL,
  job_type VARCHAR(64) NOT NULL,
  payload JSONB NOT NULL,
  -- Logical identity of the work. Enqueueing the same work twice is a no-op.
  idempotency_key VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  -- Not before this time. Backoff is expressed by pushing run_at into the future.
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Visibility timeout: a worker that dies mid-job has its job reclaimed.
  locked_at TIMESTAMPTZ,
  locked_by VARCHAR(255),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT jobs_status_check
    CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTERED'))
);

-- Idempotency is the last line of defence against a duplicate settlement or a
-- duplicate webhook, so it is enforced by the database rather than by a
-- read-then-write check in application code.
CREATE UNIQUE INDEX idx_jobs_idempotency ON jobs(idempotency_key);

-- Dequeue path: claim the oldest runnable job with FOR UPDATE SKIP LOCKED.
CREATE INDEX idx_jobs_dequeue ON jobs(queue, run_at) WHERE status = 'PENDING';

-- Reclaim path: find jobs whose worker died holding them.
CREATE INDEX idx_jobs_visibility ON jobs(locked_at) WHERE status = 'RUNNING';

-- Operator path: list work that needs a human.
CREATE INDEX idx_jobs_dead_letter ON jobs(created_at) WHERE status = 'DEAD_LETTERED';

-- DOWN
DROP TABLE IF EXISTS jobs;
