import Web3 from 'web3';
import {
    warnLog,
} from '~utils/log';
import MockWeb3 from './MockWeb3';

class Web3Service {
    constructor() {
        this.web3 = null;
        this.contracts = {};
        this.abis = {};
    }

    init({
        providerUrl = 'http://localhost:8545',
        account,
    } = {}) {
        if (process.env.NODE_ENV !== 'production'
            && providerUrl === 'graphql'
        ) {
            this.web3 = MockWeb3;
        }

        if (!this.web3) {
            const provider = new Web3.providers.HttpProvider(providerUrl);
            this.web3 = new Web3(provider);
        }

        this.account = account;
    }

    registerContract(
        config,
        {
            contractName = '',
            contractAddress = '',
        } = {},
    ) {
        if (!this.web3) return;

        const name = contractName || config.contractName;

        if (!config.abi) {
            warnLog(`Contract object "${name}" doesn't have an abi.`);
            return;
        }

        const lastNetworkId = Object.keys(config.networks).pop();
        const network = config.networks[lastNetworkId];
        const address = contractAddress
          || (network && network.address);
        if (!address) {
            warnLog(`Contract object "${name}" doesn't have an address. Please set an address first.`);
        }

        this.abis[name] = config.abi;
        this.contracts[name] = new this.web3.eth.Contract(
            config.abi,
            address,
        );
    }

    registerInterface(
        config,
        {
            name = '',
        } = {},
    ) {
        if (!this.web3) return;

        const interfaceName = name || config.contractName;
        this.abis[interfaceName] = config.abi;
    }

    hasContract(contractName) {
        return !!this.contracts[contractName];
    }

    contract(contractName) {
        if (!this.hasContract(contractName)) {
            warnLog(`Contract object "${contractName}" hasn't been initiated.`);
        }

        return this.contracts[contractName];
    }

    deployed(contractName, contractAddress = '') {
        let contract;
        if (!contractAddress) {
            contract = this.contracts[contractName];
        } else if (this.abis[contractName]) {
            contract = new this.web3.eth.Contract(
                this.abis[contractName],
                contractAddress,
            );
        }
        if (!contract) {
            warnLog(`'${contractName}' is not registered as a contract.`);
        }
        return contract;
    }

    async sendAsync(args) {
        return new Promise((resolve, reject) => {
            this.web3.givenProvider.sendAsync(args, (err, result) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(result);
            });
        });
    }

    async deploy(config, constructorArguments = []) {
        const contractObj = new this.web3.eth.Contract(config.abi);
        const { bytecode } = config;
        const { address } = this.account;
        contractObj.options.data = bytecode;

        return new Promise((resolve) => {
            contractObj
                .deploy({
                    arguments: constructorArguments,
                })
                .send({
                    from: address,
                    gas: 6500000,
                }, async (error, transactionHash) => {
                    const receipt = await this.web3.eth.getTransactionReceipt(transactionHash);
                    resolve(receipt);
                });
        });
    }

    triggerMethod = async (type, method, ...args) => {
        const { address } = this.account;
        const methodSetting = (args.length
            && typeof args[args.length - 1] === 'object'
            && args[args.length - 1])
            || null;
        const methodArgs = methodSetting
            ? args.slice(0, args.length - 1)
            : args;

        return method(...methodArgs)[type]({
            from: address,
            gas: 6500000,
            ...methodSetting,
        });
    };

    useContract(contractName, contractAddress = null) {
        return {
            method: (methodName) => {
                const contract = this.deployed(contractName, contractAddress);
                console.log(contract);
                if (!contract) {
                    throw new Error(`Cannot call method '${methodName}' of undefined.`);
                }

                const method = contract.methods[methodName];
                return {
                    call: async (...args) => this.triggerMethod('call', method, ...args),
                    send: async (...args) => this.triggerMethod('send', method, ...args),
                };
            },
            events: (eventName) => {
                const contract = this.deployed(contractName, contractAddress);
                if (!contract) {
                    throw new Error(`Cannot call waitForEvent('${eventName}') of undefined.`);
                }
                return {
                    where: (options = {}) => contract.getPastEvents(eventName, {
                        filter: options,
                    }),
                    all: () => contract.getPastEvents('allEvents', {
                        fromBlock: 0,
                    }),
                };
            },
            at: (address) => {
                if (!this.abis[contractName]) {
                    warnLog(`'${contractName}' is not registered as an interface.`);
                }
                return this.useContract(contractName, address);
            },
        };
    }
}

export default new Web3Service();