import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { KeyRound, Plus } from 'lucide-react';
import { repositoryInput, repositoryOwner } from '../server/model.ts';
import type { Region, Repository, RepositoryPage } from '../server/model.ts';
import { getTokenStatus } from './settings.ts';
import { request } from './request.ts';
import { Dialog } from './dialog.tsx';

export function TokenDialog({
  token,
  status,
  setToken,
  openAdd,
  close,
}: {
  token: string;
  status: ReturnType<typeof getTokenStatus>;
  setToken: (token: string) => void;
  openAdd: () => void;
  close: () => void;
}) {
  const [value, setValue] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = value.trim();
    if (!next) return;
    setToken(next);
    close();
    openAdd();
  }
  return (
    <Dialog title="GitHub 연결" close={close}>
      <p>
        비공개 지역을 탐험하거나 GitHub API 사용 한도를 높이려면 GitHub 토큰을
        연결하세요.
      </p>
      {token && (
        <div className="token-result" role="status">
          <strong className="token-status" data-tone={status.tone}>
            {status.label}
          </strong>
          <p>{status.description}</p>
        </div>
      )}
      <form className="token-form" onSubmit={submit}>
        <input
          id="github-token"
          aria-label="GitHub 토큰"
          type="password"
          autoComplete="off"
          required
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="github_pat_…"
        />
        <button type="submit" className="primary">
          <KeyRound size={16} /> {token ? '토큰 변경' : '토큰 연결'}
        </button>
      </form>
      {token && (
        <button
          className="text-button"
          onClick={() => {
            setToken('');
            close();
          }}
        >
          현재 토큰 연결 해제
        </button>
      )}
    </Dialog>
  );
}

export function RepositoryDialog({
  token,
  regions,
  added,
  select,
  close,
}: {
  token: string;
  regions: Region[];
  added: (repos: Repository[]) => void;
  select: (region: Region) => void;
  close: () => void;
}) {
  const [value, setValue] = useState('');
  const [page, setPage] = useState<RepositoryPage>();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController>(null);
  const owner = repositoryOwner(value);
  const existing = new Set(regions.map(({ slug }) => slug));
  useEffect(() => () => controller.current?.abort(), []);

  async function run(operation: (signal: AbortSignal) => Promise<void>) {
    if (controller.current) return;
    const current = new AbortController();
    controller.current = current;
    setError('');
    setPending(true);
    try {
      await operation(current.signal);
    } catch (cause) {
      if (!current.signal.aborted) setError((cause as Error).message);
    } finally {
      controller.current = null;
      if (!current.signal.aborted) setPending(false);
    }
  }

  function verify(slug: string, signal: AbortSignal) {
    return request<Repository>(
      new URLSearchParams({ repo: slug, repository: '1' }),
      token,
      signal,
    );
  }

  function browse(account: string, cursor?: string) {
    return run(async (signal) => {
      const params = new URLSearchParams({ owner: account });
      if (cursor) params.set('cursor', cursor);
      const result = await request<RepositoryPage>(params, token, signal);
      if (signal.aborted) return;
      setPage((previous) => {
        if (!cursor || !previous) return result;
        const repos = new Map(
          previous.repositories.map((repo) => [repo.slug, repo]),
        );
        for (const repo of result.repositories) repos.set(repo.slug, repo);
        return { ...result, repositories: [...repos.values()] };
      });
      if (!cursor) setChecked(new Set());
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (owner) {
      void browse(owner);
      return;
    }
    const slug = repositoryInput(value);
    if (!slug) {
      setError('owner, owner/repo 또는 GitHub 저장소 주소를 입력하세요.');
      return;
    }
    const match = regions.find((region) => region.slug === slug);
    if (match) {
      select(match);
      close();
      return;
    }
    void run(async (signal) => {
      const repo = await verify(slug, signal);
      if (signal.aborted) return;
      const duplicate = regions.find((region) => region.slug === repo.slug);
      if (duplicate) select(duplicate);
      else added([repo]);
      close();
    });
  }

  function addChecked() {
    void run(async (signal) => {
      const verified = new Map<string, Repository>();
      const errors: string[] = [];
      for (const slug of checked) {
        if (existing.has(slug) || signal.aborted) continue;
        try {
          const repo = await verify(slug, signal);
          if (!existing.has(repo.slug)) verified.set(repo.slug, repo);
        } catch (cause) {
          if (!signal.aborted)
            errors.push(`${slug} · ${(cause as Error).message}`);
        }
      }
      if (signal.aborted) return;
      if (verified.size) added([...verified.values()]);
      if (errors.length) setError(errors.join('\n'));
      else close();
    });
  }

  return (
    <Dialog title="저장소 추가" className="repository-dialog" close={close}>
      <form className="token-form" onSubmit={submit} aria-busy={pending}>
        <input
          id="github-repository"
          aria-label="GitHub 계정 또는 저장소"
          placeholder="owner 또는 owner/repo"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          value={value}
          disabled={pending}
          onChange={(event) => {
            setValue(event.target.value);
            setPage(undefined);
            setChecked(new Set());
            setError('');
          }}
          required
        />
        <button className="primary" type="submit" disabled={pending}>
          {owner ? '목록 보기' : '추가'}
        </button>
      </form>
      {page && (
        <>
          {page.repositories.length ? (
            <fieldset
              className="repository-options"
              disabled={pending}
              aria-label="저장소 선택"
            >
              {page.repositories.map((repo) => (
                <label key={repo.slug}>
                  <input
                    type="checkbox"
                    disabled={existing.has(repo.slug)}
                    checked={existing.has(repo.slug) || checked.has(repo.slug)}
                    onChange={(event) => {
                      const selected = event.target.checked;
                      setChecked((items) => {
                        const next = new Set(items);
                        if (selected) next.add(repo.slug);
                        else next.delete(repo.slug);
                        return next;
                      });
                    }}
                  />
                  <span>{repo.slug}</span>
                  {(existing.has(repo.slug) || repo.private) && (
                    <small>
                      {existing.has(repo.slug) ? '추가됨' : '비공개'}
                    </small>
                  )}
                </label>
              ))}
            </fieldset>
          ) : (
            <p>
              {page.next
                ? '이 페이지에 표시할 저장소가 없습니다.'
                : '조회 가능한 저장소가 없습니다.'}
            </p>
          )}
          {page.next && owner && (
            <button
              className="text-button"
              disabled={pending}
              onClick={() => void browse(owner, page.next)}
            >
              더 보기
            </button>
          )}
          <button
            className="primary repository-add-selected"
            disabled={
              pending || ![...checked].some((slug) => !existing.has(slug))
            }
            onClick={addChecked}
          >
            <Plus size={16} aria-hidden="true" /> 선택한 저장소 추가
          </button>
        </>
      )}
      {error && (
        <p className="fetch-error repository-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
