/**
 * Tests for user service module.
 */

const { processUser, getUserById, getUserByEmail, updateUser } = require('../src/user/user_service');

describe('User Service', () => {
  describe('processUser', () => {
    it('should reject invalid email', async () => {
      await expect(processUser({
        email: 'invalid-email',
        name: 'John Doe',
        password: 'Password123'
      })).rejects.toThrow('Invalid email format');
    });

    it('should reject invalid name', async () => {
      await expect(processUser({
        email: 'john@example.com',
        name: 'J',
        password: 'Password123'
      })).rejects.toThrow('Invalid name');
    });
  });

  describe('getUserById', () => {
    it('should return null for non-existent user', async () => {
      const user = await getUserById('non-existent-id');
      expect(user).toBeNull();
    });
  });

  describe('getUserByEmail', () => {
    it('should return null for non-existent email', async () => {
      const user = await getUserByEmail('nonexistent@example.com');
      expect(user).toBeNull();
    });
  });

  describe('updateUser', () => {
    it('should reject invalid name update', async () => {
      await expect(updateUser('some-id', { name: 'X' })).rejects.toThrow('Invalid name');
    });
  });
});
