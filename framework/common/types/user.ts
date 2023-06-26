export interface User {
  email: string;
  username: string;
  online?: boolean;
}

export interface UsersState {
  users: User[];
  onlineUsersByUsername: string[];
  loading: boolean;
  error: string | null;
  typingUsers: string[];
}
