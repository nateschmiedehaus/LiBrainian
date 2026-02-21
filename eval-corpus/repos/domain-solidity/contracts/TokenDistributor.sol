pragma solidity ^0.8.20;

interface IERC20 {
  function transfer(address to, uint256 value) external returns (bool);
}

contract TokenDistributor {
  IERC20 public immutable token;

  constructor(IERC20 _token) {
    token = _token;
  }

  function distribute(address[] calldata recipients, uint256[] calldata amounts) external {
    require(recipients.length == amounts.length, 'length mismatch');
    for (uint256 i = 0; i < recipients.length; i++) {
      token.transfer(recipients[i], amounts[i]);
    }
  }
}
