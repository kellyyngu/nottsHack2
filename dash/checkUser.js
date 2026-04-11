const checkUsername = async (name) => {
  try {
    // Check if the name exists on DPNS
    const nameData = await client.platform.names.resolve(`${name}.dash`);
    
    if (nameData) {
      console.log(`❌ The name ${name}.dash is already taken.`);
      return false;
    } else {
      console.log(`✅ ${name}.dash is available!`);
      return true;
    }
  } catch (e) {
    console.error('Error checking name:', e);
  }
};