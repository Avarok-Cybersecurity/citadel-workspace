import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
 
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export interface User {
  email: string
  username: string
  online?: boolean
}

export interface UsersState {
  users: User[]
  onlineUsersByUsername: string[]
  loading: boolean
  error: string | null,
  typingUsers: string[]
}

// =======================================================================================
// Messages
// =======================================================================================

export interface IMessage {
  user: string;
  message: string;
  timestamp: Date;
}