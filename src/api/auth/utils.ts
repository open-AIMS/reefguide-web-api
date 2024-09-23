/**
 * is the user an admin?
 * @param user The user to check
 * @returns True iff user is admin
 */
export const userIsAdmin = (user: Express.User): boolean => {
  return user.roles.includes("ADMIN");
};
