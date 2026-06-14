import type { Env, ProcessingJob, Submission } from './types';
import { applyTransition } from './transitions';

// SEAM:processing — replace with real validation/derivation jobs per instance.
// Stub: confirms the R2 object landed and has non-zero size. Advances on success, rejects on failure.
async function runProcessing(job: ProcessingJob, env: Env): Promise<'advance' | 'reject'> {
  const object = await env.RAW_BUCKET.head(job.r2_key);
  if (!object || object.size === 0) return 'reject';
  return 'advance';
}

export async function processQueue(
  batch: MessageBatch<ProcessingJob>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    const job = message.body;

    // Guard: skip if submission is no longer pending (retry or duplicate delivery)
    const sub = await env.DB
      .prepare('SELECT state FROM submissions WHERE id = ?')
      .bind(job.submission_id)
      .first<Pick<Submission, 'state'>>();

    if (!sub || sub.state !== 'pending') {
      message.ack();
      continue;
    }

    try {
      const action = await runProcessing(job, env);
      await applyTransition(env, job.submission_id, action, 'system', 'system');
      message.ack();
    } catch (err) {
      // Transient error — let the Queue retry (no ack = implicit retry)
      console.error(`[queue] processing failed for ${job.submission_id}:`, err);
      message.retry();
    }
  }
}
