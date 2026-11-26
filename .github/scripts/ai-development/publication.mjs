export class JournalWriteError extends Error {}

export async function writeJournal({
  repo,
  number,
  comment,
  body,
  checkpoint,
}) {
  async function write() {
    if (comment) {
      await repo(`/issues/comments/${comment.id}`, {
        method: 'PATCH',
        body: { body },
      });
    } else {
      comment = await repo(`/issues/${number}/comments`, {
        method: 'POST',
        body: { body },
      });
    }
  }
  for (let attempt = 0; ; attempt++) {
    try {
      await write();
      break;
    } catch (error) {
      if (error.status && (error.status < 500 || error.status > 599))
        throw new JournalWriteError('진행 댓글 쓰기가 거부되었습니다.', {
          cause: error,
        });
      // A failed response can follow a successful write. Reconcile only this journal.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      let latest;
      try {
        latest = await checkpoint();
      } catch (readError) {
        throw new JournalWriteError(
          '진행 댓글 게시 결과를 조회할 수 없습니다.',
          { cause: readError },
        );
      }
      if (
        latest?.entry.body === body &&
        (!comment || comment.id === latest.entry.id)
      ) {
        comment = latest.entry;
        break;
      }
      const unchanged = comment
        ? latest?.entry.id === comment.id && latest.entry.body === comment.body
        : !latest;
      if (!unchanged || attempt >= 1)
        throw new JournalWriteError(
          '진행 댓글을 안전하게 저장할 수 없습니다.',
          { cause: error },
        );
    }
  }
  comment.body = body;
  return comment;
}

export function reviewPublisher({
  repo,
  fingerprint,
  checkBase,
  getPublication,
  save,
}) {
  async function findReview(pullNumber, digest) {
    for (let page = 1; ; page++) {
      const entries = await repo(
        `/issues/${pullNumber}/comments?per_page=100&page=${page}`,
      );
      const match = entries.find(
        ({ user, body }) =>
          user?.login === 'github-actions[bot]' && fingerprint(body) === digest,
      );
      if (match || entries.length < 100) return match;
    }
  }
  async function publishReview(pullNumber, body, baseSha) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await repo(`/issues/${pullNumber}/comments`, {
          method: 'POST',
          body: { body },
        });
      } catch (error) {
        if (!(error.status >= 500 && error.status < 600)) throw error;
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * (attempt + 1)),
        );
        await checkBase(baseSha);
        const match = await findReview(pullNumber, fingerprint(body));
        if (match) return match;
        if (attempt >= 1) {
          const publication = getPublication();
          publication.retryable = true;
          if (publication.delayedRetryReserved) throw error;
          publication.delayedRetryReserved = true;
          await save('recovering', '리뷰 댓글 게시 재시도 대기 중입니다.');
          await new Promise((resolve) => setTimeout(resolve, 30_000));
          await checkBase(baseSha);
          const existing = await findReview(pullNumber, publication.bodyHash);
          if (existing) return existing;
        }
      }
    }
  }
  return { findReview, publishReview };
}
