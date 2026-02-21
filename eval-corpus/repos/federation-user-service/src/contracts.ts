export interface UserContract {
  id: string;
  email: string;
  status: 'active' | 'disabled';
}
