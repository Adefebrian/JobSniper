export interface Clock {
  now(): Date;
}

export interface CredentialStore {
  get(name: string): Promise<string | undefined>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
}

export interface IdGenerator {
  newId(): string;
}
