
import dotenv from 'dotenv';
dotenv.config();
import "@nomicfoundation/hardhat-viem";

/** @type import('hardhat/config').HardhatUserConfig */
export default {
    solidity: "0.8.24",
    networks: {
        etherlinkShadownet: {
            url: "https://node.shadownet.etherlink.com",
            chainId: 127823,
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
            type: "http",
        },
        etherlinkSandbox: {
            url: "http://localhost:8545",
            chainId: 127823,
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
            type: "http",
        },
    },
};
