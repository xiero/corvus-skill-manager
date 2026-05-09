import {execa} from 'execa';

export interface GitRunOptions {
  cwd?: string;
}

export interface GitRunResult {
  stdout: string;
  stderr: string;
}

export type GitRunner = (args: string[], options?: GitRunOptions) => Promise<GitRunResult>;

export const runGit: GitRunner = async (args, options = {}) => {
  const execaOptions =
    options.cwd === undefined ?
      {
        env: {
          GIT_OPTIONAL_LOCKS: '0'
        }
      } :
      {
        cwd: options.cwd,
        env: {
          GIT_OPTIONAL_LOCKS: '0'
        }
      };
  const result = await execa('git', args, {
    ...execaOptions
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr
  };
};
