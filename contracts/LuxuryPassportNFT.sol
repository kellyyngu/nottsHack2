// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @title Luxury Passport NFT
/// @notice Each NFT represents a luxury bag and its core metadata.
contract LuxuryPassportNFT is ERC721 {
    struct BagMetadata {
        string bagName;
        string itemDescription;
        string condition;
        string material;
        string imageURI;
        string dashTxId;
        string listingType;
        string listingStartPriceDash;
        string listingEndTime;
    }

    uint256 private _nextTokenId;
    mapping(uint256 => BagMetadata) private _bagMetadata;

    constructor() ERC721("LuxuryPassport", "LPNFT") {}

    /// @notice Safely mints a new NFT and stores its bag metadata.
    /// @param to Recipient address.
    /// @param bagName Name of the bag.
    /// @param itemDescription Description of the bag.
    /// @param condition Condition of the bag.
    /// @param material Material of the bag.
    /// @param imageURI Image URI or data URI for displaying the bag image.
    /// @param dashTxId Dash payment transaction ID used for this mint.
    /// @param listingType Listing mode (fixed, auction, donate).
    /// @param listingStartPriceDash Initial listing price/start bid in DASH as text.
    /// @param listingEndTime Listing end time in ISO-8601 format.
    /// @return tokenId The newly minted token ID.
    function safeMint(
        address to,
        string calldata bagName,
        string calldata itemDescription,
        string calldata condition,
        string calldata material,
        string calldata imageURI,
        string calldata dashTxId,
        string calldata listingType,
        string calldata listingStartPriceDash,
        string calldata listingEndTime
    ) external returns (uint256 tokenId) {
        require(bytes(dashTxId).length > 0, "dashTxId required");

        tokenId = _nextTokenId;
        _nextTokenId += 1;

        _safeMint(to, tokenId);
        _bagMetadata[tokenId] = BagMetadata({
            bagName: bagName,
            itemDescription: itemDescription,
            condition: condition,
            material: material,
            imageURI: imageURI,
            dashTxId: dashTxId,
            listingType: listingType,
            listingStartPriceDash: listingStartPriceDash,
            listingEndTime: listingEndTime
        });
    }

    /// @notice Returns stored bag metadata for a token ID.
    function getBagMetadata(uint256 tokenId) external view returns (BagMetadata memory) {
        require(tokenId < _nextTokenId, "Token does not exist");
        return _bagMetadata[tokenId];
    }
}
