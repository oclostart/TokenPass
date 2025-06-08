const readline = require('readline-sync');
const fs = require('fs');
const WebSocket = require('ws');

const CLIO_WS_URL = 'wss://s1.ripple.com'; // Ripple S1 Clio server
const nftGroups = [];
const walletGroups = [];
const items = []; // Store items for sale
const polls = []; // Store polls
let requestCounter = 0;
let loggedInWallets = []; // Simulated wallets for viewing

// Prompt for two simulated wallet addresses at startup
function setupWallets() {
    console.log('=== Simulated User Wallets ===');
    const wallet1 = readline.question('Enter first XRPL wallet address: ').trim();
    const wallet2 = readline.question('Enter second XRPL wallet address: ').trim();
    if (wallet1 && wallet2 && wallet1 !== wallet2) {
        loggedInWallets = [wallet1, wallet2];
        console.log(`Simulated wallets: ${wallet1}, ${wallet2}`);
    } else {
        console.log('Invalid or duplicate wallets. Try again.');
        setupWallets();
    }
}

// Fetch NFT details via WebSocket using nfserial or nft_id
async function fetchNFTInfo(identifier, isNFTokenID = false) {
    return new Promise((resolve) => {
        const ws = new WebSocket(CLIO_WS_URL);

        ws.on('open', () => {
            requestCounter++;
            console.log(`Sending nft_info request: ${isNFTokenID ? 'nft_id' : 'nfserial'}=${JSON.stringify(identifier)}`);
            const request = {
                id: `nft_info_${requestCounter}`,
                command: 'nft_info',
                ledger_index: 'validated'
            };
            if (isNFTokenID) {
                request.nft_id = identifier;
            } else {
                request.params = [identifier];
            }
            ws.send(JSON.stringify(request));
        });

        ws.on('message', (data) => {
            try {
                const response = JSON.parse(data.toString());
                console.log(`Response for ${isNFTokenID ? 'nft_id' : 'nfserial'} ${JSON.stringify(identifier)}:`, JSON.stringify(response, null, 2));
                if (response.status === 'success' && response.result) {
                    resolve(response.result);
                } else {
                    console.warn(`NFT not found: ${isNFTokenID ? 'nft_id' : 'nfserial'}=${JSON.stringify(identifier)}`);
                    resolve(null);
                }
            } catch (err) {
                console.error(`Error parsing response for ${isNFTokenID ? 'nft_id' : 'nfserial'}:`, err.message);
                resolve(null);
            } finally {
                ws.close();
            }
        });

        ws.on('error', (error) => {
            console.error(`WebSocket error for ${isNFTokenID ? 'nft_id' : 'nfserial'}:`, error.message);
            resolve(null);
            ws.close();
        });

        ws.on('close', () => {
            console.log(`WebSocket closed for ${isNFTokenID ? 'nft_id' : 'nfserial'}`);
        });
    });
}

// Fetch NFT details for a specific serial
async function fetchNFTBySerial(issuer, nftaxon, nfserial) {
    const result = await fetchNFTInfo({ issuer, nftaxon, nfserial });
    return result ? result.nft_id : null;
}

// Fetch all NFTs for an issuer and taxon using account_nfts
async function fetchAllNFTs(issuer, nftaxon) {
    return new Promise((resolve) => {
        const ws = new WebSocket(CLIO_WS_URL);

        ws.on('open', () => {
            requestCounter++;
            console.log(`Sending account_nfts request for issuer=${issuer}, taxon=${nftaxon || 'all'}`);
            ws.send(JSON.stringify({
                id: `account_nfts_${requestCounter}`,
                command: 'account_nfts',
                account: issuer,
                ledger_index: 'validated'
            }));
        });

        ws.on('message', (data) => {
            try {
                const response = JSON.parse(data.toString());
                console.log(`Response for account_nfts:`, JSON.stringify(response, null, 2));
                if (response.status === 'success' && response.result && response.result.account_nfts) {
                    const nfts = nftaxon !== null && nftaxon !== undefined
                        ? response.result.account_nfts.filter(nft => nft.NFTaxon === nftaxon)
                        : response.result.account_nfts;
                    const nftIds = nfts.map(nft => {
                        console.log(`NFT: NFTokenID=${nft.NFTokenID}, Taxon=${nft.NFTaxon}, Serial=${nft.Serial}`);
                        return nft.NFTokenID;
                    });
                    console.log(`Found ${nftIds.length} NFTs for issuer=${issuer}, taxon=${nftaxon || 'all'}`);
                    resolve(nftIds);
                } else {
                    console.warn(`No NFTs found for issuer=${issuer}`);
                    resolve([]);
                }
            } catch (error) {
                console.error(`Error parsing account_nfts response:`, error.message);
                resolve([]);
            } finally {
                ws.close();
            }
        });

        ws.on('error', (error) => {
            console.error(`WebSocket error for account_nfts:`, error.message);
            resolve([]);
            ws.close();
        });

        ws.on('close', () => {
            console.log(`WebSocket closed for account_nfts`);
        });
    });
}

// Fetch NFT details for a range of serials
async function fetchNFTs(issuer, taxon, start, end) {
    const nftIds = [];

    for (let serial = start; serial <= end; serial++) {
        console.log(`Fetching NFT for serial ${serial}`);
        const nftId = await fetchNFTBySerial(issuer, taxon, serial);
        if (nftId) {
            nftIds.push(nftId);
            console.log(`Found NFT: ${nftId}`);
        } else {
            console.log(`No NFT found for serial ${serial}`);
        }
        await new Promise(resolve => setTimeout(resolve, 200)); // Avoid rate-limiting
    }

    console.log(`Fetched ${nftIds.length} NFTs for issuer=${issuer}, taxon=${taxon}, range=${start}-${end}`);
    return nftIds;
}

// Take a live snapshot of wallet addresses holding NFTs in the NFT Group
async function takeSnapshot(nftGroup) {
    console.log(`Taking snapshot for NFT Group: ${nftGroup.name}`);
    const walletAddresses = [];

    for (const nftId of nftGroup.nftIds) {
        console.log(`Fetching owner for NFT: ${nftId}`);
        const result = await fetchNFTInfo(nftId, true);
        if (result && result.owner) {
            walletAddresses.push(result.owner);
            console.log(`Found owner: ${result.owner} for NFT ${nftId}`);
        } else {
            console.warn(`No owner found for NFT ${nftId}`);
        }
        await new Promise(resolve => setTimeout(resolve, 200)); // Avoid rate-limiting
    }

    console.log(`Snapshot found ${walletAddresses.length} wallet addresses`);
    return [...new Set(walletAddresses)]; // Remove duplicates
}

// Schedule snapshot
async function scheduleSnapshot(nftGroup) {
    const year = parseInt(readline.question('Year: '));
    const month = parseInt(readline.question('Month: '));
    const day = parseInt(readline.question('Day: '));
    const hour = parseInt(readline.question('Hour: '));
    const minute = parseInt(readline.question('Minute: '));
    console.log(`Snapshot scheduled for ${year}-${month}-${day} ${hour}:${minute}`);
    return await takeSnapshot(nftGroup);
}

// Check if a wallet is eligible for a group (owns NFT or in Wallet Group)
async function isWalletEligible(wallet, group) {
    if (!group) return false;
    if (group.nftIds) {
        for (const nftId of group.nftIds) {
            const result = await fetchNFTInfo(nftId, true);
            if (result && result.owner === wallet) {
                return true;
            }
        }
        return false;
    } else if (group.walletAddresses) {
        return group.walletAddresses.includes(wallet);
    }
    return false;
}

// Create Item
async function createItem() {
    const itemName = readline.question('Enter Item Name: ');
    const itemPrice = parseFloat(readline.question('Enter Item Price (XRP): '));
    if (!itemName || isNaN(itemPrice) || itemPrice <= 0) {
        console.log('Invalid item name or price. Try again.');
        return mainMenu();
    }

    let group = null;
    let isExclusive = false;
    let discountXRP = 0;

    if (nftGroups.length > 0 || walletGroups.length > 0) {
        console.log('Would you like to restrict access? (yes/no)');
        const restrictAccess = readline.question('').toLowerCase();
        if (restrictAccess === 'yes') {
            console.log('\nSelect a group to apply:');
            const allGroups = [...nftGroups, ...walletGroups];
            allGroups.forEach((g, index) => console.log(`${index + 1} - ${g.name} (${g.nftIds ? 'NFT' : 'Wallet'} Group)`));
            const groupIndex = parseInt(readline.question('Enter group number: ')) - 1;
            if (groupIndex >= 0 && groupIndex < allGroups.length) {
                group = allGroups[groupIndex];
                console.log('Make it exclusive or provide a discount? (1 - Exclusive, 2 - Discount)');
                const accessChoice = readline.question('Enter option: ');
                if (accessChoice === '1') {
                    isExclusive = true;
                } else if (accessChoice === '2') {
                    discountXRP = parseFloat(readline.question('Enter discount amount (XRP): '));
                    if (isNaN(discountXRP) || discountXRP < 0 || discountXRP > itemPrice) {
                        console.log('Invalid discount amount. Try again.');
                        return mainMenu();
                    }
                } else {
                    console.log('Invalid option.');
                    return mainMenu();
                }
            } else {
                console.log('Invalid group selection.');
                return mainMenu();
            }
        }
    }

    items.push({ itemName, itemPrice, group, isExclusive, discountXRP });
    console.log(`\nItem "${itemName}" created successfully!`);
    mainMenu();
}

// Create Poll
async function createPoll() {
    const pollName = readline.question('Enter Poll Name: ');
    const pollQuestion = readline.question('Enter Poll Question: ');
    if (!pollName || !pollQuestion) {
        console.log('Invalid poll name or question. Try again.');
        return mainMenu();
    }

    const answers = [];
    console.log('Enter at least 2 answers for the poll:');
    answers.push(readline.question('Answer 1: ').trim());
    answers.push(readline.question('Answer 2: ').trim());

    while (answers.length < 4) {
        console.log('Would you like to add another answer? (yes/no)');
        const addMore = readline.question('').toLowerCase();
        if (addMore !== 'yes') break;
        const newAnswer = readline.question(`Answer ${answers.length + 1}: `).trim();
        if (newAnswer) answers.push(newAnswer);
    }

    if (answers.length < 2) {
        console.log('At least 2 answers are required. Try again.');
        return mainMenu();
    }

    let group = null;

    if (nftGroups.length > 0 || walletGroups.length > 0) {
        console.log('Would you like to restrict access? (Only group members can view) (yes/no)');
        const restrictAccess = readline.question('').toLowerCase();
        if (restrictAccess === 'yes') {
            console.log('\nSelect a group to apply:');
            const allGroups = [...nftGroups, ...walletGroups];
            allGroups.forEach((g, index) => console.log(`${index + 1} - ${g.name} (${g.nftIds ? 'NFT' : 'Wallet'} Group)`));
            const groupIndex = parseInt(readline.question('Enter group number: ')) - 1;
            if (groupIndex >= 0 && groupIndex < allGroups.length) {
                group = allGroups[groupIndex];
            } else {
                console.log('Invalid group selection.');
                return mainMenu();
            }
        }
    }

    polls.push({ pollName, pollQuestion, answers, group, isExclusive: !!group });
    console.log(`\nPoll "${pollName}" created successfully!`);
    mainMenu();
}

// View Items as Guest
async function viewItemsAsGuest() {
    if (items.length === 0) {
        console.log('\nNo items available.');
        return mainMenu();
    }

    console.log('\nView items as:');
    console.log('1 - Guest (no wallet)');
    loggedInWallets.forEach((wallet, index) => console.log(`${index + 2} - ${wallet}`));
    const viewChoice = parseInt(readline.question('Enter option: '));
    const viewingWallet = viewChoice === 1 ? null : loggedInWallets[viewChoice - 2];

    console.log('\n=== Items for Sale ===');
    for (const item of items) {
        console.log(`\nItem: ${item.itemName}`);
        if (item.group) {
            const isEligible = viewingWallet ? await isWalletEligible(viewingWallet, item.group) : false;
            if (item.isExclusive) {
                if (!isEligible && !viewingWallet) {
                    console.log(`- Exclusive to ${item.group.name} group (Guest view)`);
                } else if (!isEligible) {
                    console.log(`- Exclusive to ${item.group.name} group`);
                } else {
                    console.log(`- Price: ${item.itemPrice.toFixed(2)} XRP`);
                }
            } else {
                const finalPrice = isEligible ? (item.itemPrice - item.discountXRP) : item.itemPrice;
                console.log(`- Price: ${finalPrice.toFixed(2)} XRP`);
            }
        } else {
            console.log(`- Price: ${item.itemPrice.toFixed(2)} XRP`);
        }
    }
    mainMenu();
}

// View Polls as Guest
async function viewPollsAsGuest() {
    if (polls.length === 0) {
        console.log('\nNo polls available.');
        return mainMenu();
    }

    console.log('\nView polls as:');
    console.log('1 - Guest (no wallet)');
    loggedInWallets.forEach((wallet, index) => console.log(`${index + 2} - ${wallet}`));
    const viewChoice = parseInt(readline.question('Enter option: '));
    const viewingWallet = viewChoice === 1 ? null : loggedInWallets[viewChoice - 2];

    console.log('\n=== Polls ===');
    let hasAccessiblePolls = false;

    for (const poll of polls) {
        const isEligible = viewingWallet ? await isWalletEligible(viewingWallet, poll.group) : false;
        if (!poll.group || (viewingWallet && isEligible)) {
            hasAccessiblePolls = true;
            console.log(`\nPoll: ${poll.pollName}`);
            console.log(`Question: ${poll.pollQuestion}`);
            console.log('Answers:');
            poll.answers.forEach((answer, index) => console.log(`${index + 1}. ${answer}`));
        }
    }

    if (!hasAccessiblePolls) {
        console.log('\nNo polls available.');
    }

    return mainMenu();
}

// Main menu
function mainMenu() {
    const hasGroups = nftGroups.length > 0 || walletGroups.length > 0;
    console.log(`
Do you want to:
1 - Create NFT Group
2 - Create Wallet Group
3 - View Groups
${hasGroups ? '4 - Export Group\n' : ''}5 - Create Item
6 - View Items as Guest
7 - Create Poll
8 - View Polls as Guest
`);
    const choice = readline.question('Enter option: ');

    switch (choice) {
        case '1':
            createNFTGroup();
            break;
        case '2':
            createWalletGroup();
            break;
        case '3':
            viewGroups();
            break;
        case '4':
            if (hasGroups) exportGroup();
            else {
                console.log('Invalid choice, try again.');
                mainMenu();
            }
            break;
        case '5':
            createItem();
            break;
        case '6':
            viewItemsAsGuest();
            break;
        case '7':
            createPoll();
            break;
        case '8':
            viewPollsAsGuest();
            break;
        default:
            console.log('Invalid choice, try again.');
            mainMenu();
    }
}

// Create NFT Group
async function createNFTGroup() {
    const name = readline.question('Enter NFT Group name: ');
    const description = readline.question('Enter NFT Group description: ');
    const nftGroup = { name, description, nftIds: [] };

    while (true) {
        console.log(`
Would you like to add:
1 - Single NFTs
2 - A range of NFTs in a collection
3 - An NFT collection
        `);

        const input = readline.question('Enter option: ');

        if (input === '1') {
            const nftIds = readline.question('Enter NFT IDs (comma-separated): ').split(',');
            nftGroup.nftIds.push(...nftIds.map(id => id.trim()));
        } else if (input === '2') {
            const issuer = readline.question('Enter issuer address: ');
            const taxon = parseInt(readline.question('Enter collection taxon: '));
            const start = parseInt(readline.question('Enter serial start range: '));
            const end = parseInt(readline.question('Enter serial end range: '));

            try {
                const fetchedNFTs = await fetchNFTs(issuer, taxon, start, end);
                nftGroup.nftIds.push(...fetchedNFTs);
            } catch (error) {
                console.error(`Error fetching NFTs:`, error.message);
            }
        } else if (input === '3') {
            const issuer = readline.question('Enter issuer address: ');
            const taxonInput = readline.question('Enter collection taxon (or leave blank for all): ');
            const taxon = taxonInput.trim() ? parseInt(taxonInput) : null;

            try {
                const fetchedNFTs = await fetchAllNFTs(issuer, taxon);
                nftGroup.nftIds.push(...fetchedNFTs);
            } catch (error) {
                console.error(`Error fetching NFT collection:`, error.message);
            }
        } else {
            console.log('Invalid option.');
            continue;
        }

        console.log(`Added ${nftGroup.nftIds.length} NFTs to group "${name}"`);
        const another = readline.question('Would you like to add another record? (yes/no) ').toLowerCase();
        if (another !== 'yes') break;
    }

    if (nftGroup.nftIds.length > 0) {
        nftGroups.push(nftGroup);
        console.log('\nNFT Group created successfully!');
    } else {
        console.log('\nNo NFTs added to group. Group not created.');
    }
    mainMenu();
}

// Create Wallet Group
async function createWalletGroup() {
    const name = readline.question('Enter Wallet Group name: ');
    const description = readline.question('Enter Wallet Group description: ');
    const walletGroup = { name, description, walletAddresses: [] };

    while (true) {
        console.log(`
Would you like to:
1 - Manually add wallet addresses
2 - Take a snapshot
        `);

        const input = readline.question('Enter option: ');

        if (input === '1') {
            const addresses = readline.question('Enter wallet addresses (comma-separated): ').split(',');
            walletGroup.walletAddresses.push(...addresses.map(addr => addr.trim()));
        } else if (input === '2') {
            if (nftGroups.length === 0) {
                console.log('An NFT Group is needed for a snapshot.');
                continue;
            }
            console.log('\nSelect an NFT Group for a snapshot:');
            nftGroups.forEach((group, index) => console.log(`${index + 1} - ${group.name}`));
            const groupIndex = parseInt(readline.question('Enter group number: ')) - 1;

            if (groupIndex < 0 || groupIndex >= nftGroups.length) {
                console.log('Invalid selection.');
                continue;
            }

            const selectedGroup = nftGroups[groupIndex];
            console.log(`
Schedule snapshot:
1 - Schedule
2 - Run now
            `);
            const snapshotChoice = readline.question('Enter option: ');

            if (snapshotChoice === '1') {
                const addresses = await scheduleSnapshot(selectedGroup);
                walletGroup.walletAddresses.push(...addresses);
            } else if (snapshotChoice === '2') {
                const addresses = await takeSnapshot(selectedGroup);
                walletGroup.walletAddresses.push(...addresses);
            } else {
                console.log('Invalid option.');
                continue;
            }
        } else {
            console.log('Invalid option.');
            continue;
        }

        console.log(`Added ${walletGroup.walletAddresses.length} wallets to group "${name}"`);
        const another = readline.question('Would you like to add another record? (yes/no) ').toLowerCase();
        if (another !== 'yes') break;
    }

    if (walletGroup.walletAddresses.length > 0) {
        walletGroups.push(walletGroup);
        console.log('\nWallet Group created successfully!');
    } else {
        console.log('\nNo wallets added to group. Group not created.');
    }
    mainMenu();
}

// View Groups
function viewGroups() {
    if (nftGroups.length === 0 && walletGroups.length === 0) {
        console.log('\nNo groups have been created.');
    } else {
        console.log('\nNFT Groups:');
        nftGroups.forEach((group, index) => {
            console.log(`${index + 1} - ${group.name} (${group.nftIds.length} NFTs)`);
            console.log(`  Description: ${group.description}`);
            console.log(`  NFTs: ${group.nftIds.join(', ')}`);
        });

        console.log('\nWallet Groups:');
        walletGroups.forEach((group, index) => {
            console.log(`${index + 1} - ${group.name} (${group.walletAddresses.length} wallets)`);
            console.log(`  Description: ${group.description}`);
            console.log(`  Wallets: ${group.walletAddresses.join(', ')}`);
        });
    }
    mainMenu();
}

// Export Group
function exportGroup() {
    const allGroups = [...nftGroups, ...walletGroups];

    console.log('\nSelect a group to export:');
    allGroups.forEach((group, index) => console.log(`${index + 1} - ${group.name}`));

    const groupIndex = parseInt(readline.question('Enter group number: ')) - 1;

    if (groupIndex < 0 || groupIndex >= allGroups.length) {
        console.log('Invalid selection.');
        mainMenu();
        return;
    }

    const selectedGroup = allGroups[groupIndex];
    const records = selectedGroup.nftIds?.length > 0 
        ? selectedGroup.nftIds 
        : selectedGroup.walletAddresses?.length > 0 
        ? selectedGroup.walletAddresses 
        : [];

    if (records.length === 0) {
        console.log('\nNo NFTs or wallets to export.');
        mainMenu();
        return;
    }

    const csvData = `Name,Description,Records\n${selectedGroup.name},${selectedGroup.description},${records.join('|')}`;
    fs.writeFileSync(`${selectedGroup.name}.csv`, csvData);
    console.log(`\nGroup exported to ${selectedGroup.name}.csv`);
    mainMenu();
}

// Start the application
setupWallets();
mainMenu();