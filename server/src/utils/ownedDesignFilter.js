export function ownedDesignFilter(user) {
  if (user?.id && user?.email) {
    return {
      $or: [
        { ownerId: user.id },
        {
          $and: [
            { ownerId: { $in: [null] } },
            { 'user.email': user.email }
          ]
        }
      ]
    };
  }
  if (user?.id) return { ownerId: user.id };
  if (user?.email) return { 'user.email': user.email };

  return { _id: null };
}
