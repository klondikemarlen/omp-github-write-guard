export type GitHubWrite = {
  action: string;
  target?: string;
  targetUnresolved?: boolean;
  directories?: string[];
  remote?: string;
  description?: string;
  reviewThreadId?: string;
  reviewThreadUnresolved?: boolean;
};
