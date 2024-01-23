import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { Cat21 } from '../types/cat21';
import { TransactionBlockchair } from '../types/transaction-blockchair';
import { BlockchairApiService } from './blockchair-api.service';
import { OrdApiService } from './ord-api.service';
import { EsploraApiService } from './esplora-api.service';
import { delay } from '../utils/delay';



@Injectable()
export class CatService {

  private cats: Cat21[] = [];

  constructor(private blockchairApi: BlockchairApiService,
    private esploraApi: EsploraApiService,
    private ordApi: OrdApiService) {
  }

  /**
   * Performing async tasks before controllers are available
   */
  async onModuleInit() {
    // return; // while debugging
    Logger.log('Initializing CatService', 'cat_service');
    await this.handleInterval(); // immediate execution upon module initialization

    Logger.verbose(`Successfully indexed ${this.cats.length} CAT-21 assets! 😺`, 'cat_service');
  }

  @Interval(1000 * 60 * 5) // every 5 minutes
  async handleInterval() {
    await this.indexAllCats();
  }

  private async indexAllCats() {

    try {
      const transactions = await this.blockchairApi.fetchAllCat21Transactions();

      if (transactions.length > this.cats.length) {

        Logger.verbose(`Found ${transactions.length} CAT-21 transactions. Trying to update the cache...`, 'cat_service');
        const cats = this.transactionsToCats(transactions);

        Logger.verbose(`Adding block information from esplora...`, 'cat_service');
        await this.addBlockInformation(cats);

        Logger.verbose(`Adding output information from ord...`, 'cat_service');
        await this.addOutputInformation(cats);

        this.cats = cats;
      } else {
        // Logger.verbose(`Found ${transactions.length} CAT-21 transactions but there are already ${this.cats.length} cached!`, 'cat_service');
      }
    } catch (error) {
      Logger.error(`** Error indexing all cats! **`, error);
      // don't throw here! if this errors a startup, the app will exit with code 1
      // throw error;
    }
  }

  /**
   * Retrieves all CAT-21 assets (cached)
   */
  async getAllCats(): Promise<Cat21[]> {

    // something must have went very wrong?! we still have a count of zero?
    // let's try again to build an index
    if (!this.cats.length) {
      await this.indexAllCats();
    }

    // copy to new array to protect the array against mutation
    // (only required if we reverse the array)
    // return this.allCats.map(c => c);

    return this.cats;
  }

  /**
   * Finds all CAT-21 assets (cached) whose sat value falls within any of the provided ranges.
   *
   * @param satRanges - Array of satoshi ranges to search for.
   * @returns Array of CAT-21 assets matching the sat ranges.
   */
  async findCatsBySatRanges(satRanges: [number, number][]): Promise<Cat21[]> {
    return this.cats.filter(cat =>
      satRanges.some(([start, end]) => cat.sat >= start && cat.sat <= end)
    );
  }

  /**
   * Mutates the cats and adds information about block
   * via Esplora (Blockstream)
   */
  private async addBlockInformation(cats: Cat21[]) {

    let first = true;
    for (const cat of cats) {
      try {

        if (!first) {
          await delay(50); // avoid Too Many Requests
        } else {
          first = false;
        }

        const transaction = await this.esploraApi.fetchTransaction(cat.transactionId);
        cat.blockId = transaction.status.block_hash || 'unconfirmed??'
        cat.blockTime = transaction.status.block_time || -1;

      } catch (error) {
        Logger.warn(`** Error enriching block data for cat ${cat.transactionId}. **`, error);
        throw error;
      }
    }
  }

  /**
   * Mutates the cats and adds information about the first Output of the transaction
   * via Or
   */
  private async addOutputInformation(cats: Cat21[]) {

    for (const cat of cats) {
      try {

        const firstOutput = await this.ordApi.fetchOutput(cat.transactionId + ':0');
        cat.value = firstOutput.value;
        // if sat tracking is disabled (or not tracked yet)
        cat.sat = firstOutput.sat_ranges && firstOutput.sat_ranges.length && firstOutput.sat_ranges[0][0];
        cat.firstOwner = firstOutput.address;
        // cat.currentOwner = firstOutput.address;

      } catch (error) {
        Logger.warn(`** Error enriching output data for cat ${cat.transactionId}. **`, error);
        throw error;
      }
    }
  }

  /**
   * Maps an array of TransactionBlockchair to an array of Cat21
   */
  private transactionsToCats(transactions: TransactionBlockchair[]): Cat21[] {

    let counter = transactions.length - 1;
    return transactions.map(tx => ({
      transactionId: tx.hash,
      number: counter--,
      blockHeight: tx.block_id,
      fee: tx.fee,
      size: tx.size,
      weight: tx.weight,

      // will be added later on by esplora
      blockId: '',
      blockTime: -1,

      // will be added later on by ord
      value: -1,
      sat: -1,
      firstOwner: '',
      // currentOwner: ''
    }));
  }
}
