// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @title Luxury Passport NFT
/// @notice Each NFT represents a luxury bag and its core metadata.
contract LuxuryPassportNFT is ERC721 {
    struct BagMetadata {
        string bagName;
        string condition;
        string material;
        string imageURI;
    }

    uint256 private _nextTokenId;
    mapping(uint256 => BagMetadata) private _bagMetadata;

    constructor() ERC721("LuxuryPassport", "LPNFT") {}

    /// @notice Safely mints a new NFT and stores its bag metadata.
    /// @param to Recipient address.
    /// @param bagName Name of the bag.
    /// @param condition Condition of the bag.
    /// @param material Material of the bag.
    /// @param imageURI Image URI or data URI for displaying the bag image.
    /// @return tokenId The newly minted token ID.
    function safeMint(
        address to,
        string calldata bagName,
        string calldata condition,
        string calldata material,
        string calldata imageURI
    ) external returns (uint256 tokenId) {
        tokenId = _nextTokenId;
        _nextTokenId += 1;

        _safeMint(to, tokenId);
        _bagMetadata[tokenId] = BagMetadata({
            bagName: bagName,
            condition: condition,
            material: material,
            imageURI: imageURI
        });
    }

    /// @notice Returns stored bag metadata for a token ID.
    function getBagMetadata(uint256 tokenId) external view returns (BagMetadata memory) {
        require(tokenId < _nextTokenId, "Token does not exist");
        return _bagMetadata[tokenId];
    }
}
