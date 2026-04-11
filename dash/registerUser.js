const registerUser = async (username) => {
  try {
    const isAvailable = await checkUsername(username);
    if (!isAvailable) return;

    console.log('Registering Identity... (this takes ~1-2 minutes)');
    const identity = await client.platform.identities.register();
    const identityId = identity.getId().toJSON();
    console.log('Identity Created:', identityId);

    console.log(`Registering Name: ${username}.dash...`);
    const nameRegistration = await client.platform.names.register(
      `${username}.dash`,
      { dashUniqueIdentityId: identity.getId() },
      identity,
    );

    console.log('Success! ecoTrace user created.');
    return { identityId, username: `${username}.dash` };
  } catch (e) {
    console.error('Registration failed:', e);
  }
};