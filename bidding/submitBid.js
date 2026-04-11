export async function submitBid(client, identity, dataContractName, auctionId, amount, username) {
  const bidDocument = await client.platform.documents.create(
    `${dataContractName}.bid`,
    identity,
    {
      auctionId: auctionId,
      amount: amount,
      bidderName: username,
      timestamp: Date.now(),
    },
  );

  try {
    await client.platform.documents.broadcast({
      create: [bidDocument],
    }, identity);
    return { success: true, bidId: bidDocument.id };
  } catch (e) {
    console.error('Bid rejection:', e);
    return { success: false, error: e.message };
  }
}