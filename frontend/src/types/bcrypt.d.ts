declare module 'bcrypt' {
  /**
   * Compare a string with a hash
   * @param data The data to compare
   * @param encrypted The hash to compare against
   * @returns A promise that resolves to true if the data matches the hash, false otherwise
   */
  export function compare(data: string, encrypted: string): Promise<boolean>;

  /**
   * Generate a hash from a string
   * @param data The data to hash
   * @param saltOrRounds The salt to use, or the number of rounds to use to generate a salt
   * @returns A promise that resolves to the hash
   */
  export function hash(data: string, saltOrRounds: string | number): Promise<string>;

  /**
   * Generate a salt
   * @param rounds The number of rounds to use
   * @returns A promise that resolves to the salt
   */
  export function genSalt(rounds?: number): Promise<string>;
}
