import 'dotenv/config';
import { Prisma, PrismaClient, type AllergenFlag, type DietaryTag, type RegionTag, type StorageType, type UnitLabel } from '@prisma/client';
import argon2 from 'argon2';
import { validateEnv } from '../src/config/env.schema';
import { asJson } from '../src/common/prisma-errors';
import { shippingSettingsFromEnv } from '../src/shipping/shipping.types';

const prisma = new PrismaClient();
const env = validateEnv(process.env);

type VariantSeed = {
  sku: string;
  title: string;
  size: string;
  priceCents: number;
  netOz: string;
  shipOz: string;
  quantity: number;
};

type ProductSeed = {
  name: string;
  slug: string;
  sku: string;
  category: string;
  country: string;
  region: RegionTag;
  priceCents: number;
  compareAtPriceCents?: number;
  storage: StorageType;
  perishable?: boolean;
  shelfLifeDays?: number;
  netOz: string;
  shipOz: string;
  unit: UnitLabel;
  brand: string;
  short: string;
  description: string;
  ingredients?: string;
  allergens?: AllergenFlag[];
  dietary?: DietaryTag[];
  featured?: boolean;
  attributes?: Record<string, string | number | boolean>;
  tags: string[];
  quantity?: number;
  variants?: VariantSeed[];
};

const categories: Array<{ slug: string; name: string; parent?: string; description: string }> = [
  { slug: 'grains-and-flours', name: 'Grains and flours', description: 'Rice, garri, yam flour, and the flours used for swallows.' },
  { slug: 'rice', name: 'Rice', parent: 'grains-and-flours', description: 'Ofada, parboiled, and other rice packed for West African meals.' },
  { slug: 'garri', name: 'Garri', parent: 'grains-and-flours', description: 'Cassava granules for soaking or eba.' },
  { slug: 'yam-flour', name: 'Yam flour', parent: 'grains-and-flours', description: 'Elubo and pounded yam flour.' },
  { slug: 'plantain-flour', name: 'Plantain flour', parent: 'grains-and-flours', description: 'Green plantain flour for amala and baking.' },
  { slug: 'semolina', name: 'Semolina', parent: 'grains-and-flours', description: 'Wheat semolina for swallow.' },
  { slug: 'fufu-flour', name: 'Fufu flour', parent: 'grains-and-flours', description: 'Cocoyam, cassava, and plantain fufu mixes.' },
  { slug: 'oils-and-sauces', name: 'Oils and sauces', description: 'Palm oil, groundnut oil, and cooking sauces.' },
  { slug: 'spices-and-seasonings', name: 'Spices and seasonings', description: 'Peppers, suya spice, berbere, and soup seasonings.' },
  { slug: 'dried-fish-and-proteins', name: 'Dried fish and proteins', description: 'Stockfish, smoked fish, crayfish, and melon seed.' },
  { slug: 'canned-and-jarred', name: 'Canned and jarred', description: 'Pantry fish, leaves, and ready soup bases.' },
  { slug: 'snacks', name: 'Snacks', description: 'Chin chin, chips, and roasted snacks.' },
  { slug: 'drinks', name: 'Drinks', description: 'Non-alcoholic malt drinks and hibiscus mixes.' },
  { slug: 'frozen', name: 'Frozen', description: 'Frozen meat and produce that ships with a cold pack.' },
  { slug: 'fresh', name: 'Fresh', description: 'Fresh produce when it is in stock.' },
  { slug: 'household', name: 'Household', description: 'Soaps and pantry-adjacent staples from African grocers.' },
];

const tags = [
  { slug: 'pantry', name: 'Pantry' },
  { slug: 'soup', name: 'Soup' },
  { slug: 'swallow', name: 'Swallow' },
  { slug: 'pepper-soup', name: 'Pepper soup' },
  { slug: 'snack', name: 'Snack' },
];

const products: ProductSeed[] = [
  {
    name: 'Ofada Rice',
    slug: 'ofada-rice',
    sku: 'RICE-OFADA',
    category: 'rice',
    country: 'NG',
    region: 'west_africa',
    priceCents: 1299,
    storage: 'ambient',
    netOz: '32',
    shipOz: '34',
    unit: 'bag',
    brand: 'Ogun Farms',
    short: 'Unpolished Nigerian ofada rice with a toasted aroma.',
    description: 'Stone-milled ofada rice for party jollof, native rice, and everyday pots. Rinse before cooking.',
    ingredients: 'Ofada rice.',
    dietary: ['halal', 'vegetarian', 'vegan', 'gluten_free'],
    featured: true,
    tags: ['pantry'],
    variants: [
      { sku: 'RICE-OFADA-2', title: '2 lb', size: '2 lb', priceCents: 899, netOz: '32', shipOz: '34', quantity: 40 },
      { sku: 'RICE-OFADA-5', title: '5 lb', size: '5 lb', priceCents: 1899, netOz: '80', shipOz: '84', quantity: 24 },
    ],
  },
  {
    name: 'Long Grain Parboiled Rice',
    slug: 'long-grain-parboiled-rice',
    sku: 'RICE-PARBOIL',
    category: 'rice',
    country: 'NG',
    region: 'west_africa',
    priceCents: 1499,
    storage: 'ambient',
    netOz: '80',
    shipOz: '84',
    unit: 'bag',
    brand: 'Lagos Mill',
    short: 'The parboiled rice used for Nigerian jollof and fried rice.',
    description: 'Separate grains that hold up in tomato stew. Packed for US home kitchens.',
    ingredients: 'Parboiled long grain rice.',
    dietary: ['halal', 'vegetarian', 'vegan', 'gluten_free'],
    tags: ['pantry'],
    variants: [
      { sku: 'RICE-PARBOIL-5', title: '5 lb', size: '5 lb', priceCents: 1499, netOz: '80', shipOz: '84', quantity: 36 },
      { sku: 'RICE-PARBOIL-10', title: '10 lb', size: '10 lb', priceCents: 2699, netOz: '160', shipOz: '168', quantity: 18 },
    ],
  },
  {
    name: 'Ijebu White Garri',
    slug: 'ijebu-white-garri',
    sku: 'GARRI-IJEBU',
    category: 'garri',
    country: 'NG',
    region: 'west_africa',
    priceCents: 799,
    storage: 'ambient',
    netOz: '32',
    shipOz: '34',
    unit: 'bag',
    brand: 'Ijebu Cooperative',
    short: 'Sour cassava garri for soaking or turning into eba.',
    description: 'Fine Ijebu-style garri. Soak in cold water with groundnuts, or stir into boiling water for eba.',
    ingredients: 'Cassava.',
    dietary: ['halal', 'vegetarian', 'vegan', 'gluten_free'],
    featured: true,
    tags: ['pantry', 'swallow'],
    variants: [
      { sku: 'GARRI-IJEBU-2', title: '2 lb', size: '2 lb', priceCents: 599, netOz: '32', shipOz: '34', quantity: 40 },
      { sku: 'GARRI-IJEBU-5', title: '5 lb', size: '5 lb', priceCents: 1199, netOz: '80', shipOz: '84', quantity: 22 },
    ],
  },
  {
    name: 'Pounded Yam Flour',
    slug: 'pounded-yam-flour',
    sku: 'FLOUR-YAM',
    category: 'yam-flour',
    country: 'NG',
    region: 'west_africa',
    priceCents: 1099,
    storage: 'ambient',
    netOz: '24',
    shipOz: '26',
    unit: 'bag',
    brand: 'Oyo Mills',
    short: 'Instant pounded yam for egusi, ogbono, and vegetable soup.',
    description: 'Stir into boiling water until smooth. A weeknight stand-in for freshly pounded yam.',
    ingredients: 'Yam flour.',
    dietary: ['halal', 'vegetarian', 'vegan', 'gluten_free'],
    tags: ['swallow', 'soup'],
    variants: [
      { sku: 'FLOUR-YAM-1-5', title: '1.5 lb', size: '1.5 lb', priceCents: 899, netOz: '24', shipOz: '26', quantity: 30 },
      { sku: 'FLOUR-YAM-4', title: '4 lb', size: '4 lb', priceCents: 1899, netOz: '64', shipOz: '68', quantity: 16 },
    ],
  },
  {
    name: 'Plantain Flour',
    slug: 'plantain-flour',
    sku: 'FLOUR-PLANTAIN',
    category: 'plantain-flour',
    country: 'GH',
    region: 'west_africa',
    priceCents: 999,
    storage: 'ambient',
    netOz: '24',
    shipOz: '26',
    unit: 'bag',
    brand: 'Accra Harvest',
    short: 'Green plantain flour for amala and gluten-free baking.',
    description: 'Dried green plantain, milled fine. Use it as a swallow or in batters.',
    ingredients: 'Green plantain.',
    dietary: ['halal', 'vegetarian', 'vegan', 'gluten_free'],
    tags: ['swallow'],
    quantity: 28,
  },
  {
    name: 'Wheat Semolina',
    slug: 'wheat-semolina',
    sku: 'FLOUR-SEMOLINA',
    category: 'semolina',
    country: 'SN',
    region: 'west_africa',
    priceCents: 699,
    storage: 'ambient',
    netOz: '32',
    shipOz: '34',
    unit: 'bag',
    brand: 'Dakar Grain',
    short: 'Fine semolina for a soft wheat swallow.',
    description: 'The semolina sold in West African groceries for a smooth, pale swallow.',
    ingredients: 'Durum wheat semolina.',
    allergens: ['wheat'],
    dietary: ['halal', 'vegetarian', 'vegan'],
    tags: ['swallow'],
    quantity: 32,
  },
  {
    name: 'Cocoyam Fufu Flour',
    slug: 'cocoyam-fufu-flour',
    sku: 'FLOUR-FUFU',
    category: 'fufu-flour',
    country: 'GH',
    region: 'west_africa',
    priceCents: 899,
    storage: 'ambient',
    netOz: '24',
    shipOz: '26',
    unit: 'bag',
    brand: 'Accra Harvest',
    short: 'Cocoyam fufu flour with a mild, nutty taste.',
    description: 'Blend into boiling water for fufu. Pairs with light soup and groundnut soup.',
    ingredients: 'Cocoyam flour.',
    dietary: ['halal', 'vegetarian', 'vegan', 'gluten_free'],
    tags: ['swallow', 'soup'],
    quantity: 26,
  },
  {
    name: 'Unrefined Red Palm Oil',
    slug: 'unrefined-red-palm-oil',
    sku: 'OIL-PALM',
    category: 'oils-and-sauces',
    country: 'GH',
    region: 'west_africa',
    priceCents: 1499,
    storage: 'ambient',
    netOz: '16',
    shipOz: '28',
    unit: 'bottle',
    brand: 'Cape Coast Press',
    short: 'Traditional red palm oil for stews, jollof, and banga.',
    description: 'Unrefined palm oil with a deep color. Heat it gently until it clears before adding onions.',
    ingredients: 'Red palm oil.',
    dietary: ['halal', 'vegetarian', 'vegan', 'gluten_free'],
    featured: true,
    tags: ['pantry', 'soup'],
    variants: [
      { sku: 'OIL-PALM-16', title: '16 oz', size: '16 oz', priceCents: 1499, netOz: '16', shipOz: '28', quantity: 30 },
      { sku: 'OIL-PALM-32', title: '32 oz', size: '32 oz', priceCents: 2499, netOz: '32', shipOz: '48', quantity: 16 },
    ],
  },
  {
    name: 'Roasted Groundnut Oil',
    slug: 'roasted-groundnut-oil',
    sku: 'OIL-GROUNDNUT',
    category: 'oils-and-sauces',
    country: 'NG',
    region: 'west_africa',
    priceCents: 1399,
    storage: 'ambient',
    netOz: '16',
    shipOz: '28',
    unit: 'bottle',
    brand: 'Kano Press',
    short: 'Peanut oil pressed from roasted groundnuts.',
    description: 'A high-heat cooking oil with a light roasted smell. Contains peanuts.',
    ingredients: 'Roasted peanuts.',
    allergens: ['peanuts'],
    dietary: ['halal', 'vegetarian', 'vegan', 'gluten_free'],
    tags: ['pantry'],
    quantity: 20,
  },
  {
    name: 'Suya Spice Blend',
    slug: 'suya-spice-blend',
    sku: 'SPICE-SUYA',
    category: 'spices-and-seasonings',
    country: 'NG',
    region: 'west_africa',
    priceCents: 799,
    storage: 'ambient',
    netOz: '4',
    shipOz: '6',
    unit: 'jar',
    brand: 'Kaduna Grill',
    short: 'Groundnut and chili blend for suya and grilled chicken.',
    description: 'Salt, chili, ginger, and roasted groundnut. Pat it onto meat before grilling.',
    ingredients: 'Peanuts, chili, ginger, onion, salt, bouillon.',
    allergens: ['peanuts'],
    dietary: ['spicy'],
    featured: true,
    attributes: { heatLevel: 'medium' },
    tags: ['pepper-soup'],
    quantity: 40,
  },
  {
    name: 'Cameroon Pepper',
    slug: 'cameroon-pepper',
    sku: 'SPICE-CAMEROON',
    category: 'spices-and-seasonings',
    country: 'CM',
    region: 'west_africa',
    priceCents: 999,
    storage: 'ambient',
    netOz: '2',
    shipOz: '4',
    unit: 'jar',
    brand: 'Douala Spice',
    short: 'Smoky ground pepper for pepper soup and jollof.',
    description: 'A coarse grind of smoked chili. Start with a pinch.',
    ingredients: 'Smoked chili pepper.',
    dietary: ['halal', 'vegetarian', 'vegan', 'gluten_free', 'spicy'],
    attributes: { heatLevel: 'hot' },
    tags: ['pepper-soup', 'soup'],
    quantity: 36,
  },
  {
    name: 'Berbere Spice',
    slug: 'berbere-spice',
    sku: 'SPICE-BERBERE',
    category: 'spices-and-seasonings',
    country: 'ET',
    region: 'east_africa',
    priceCents: 899,
    storage: 'ambient',
    netOz: '4',
    shipOz: '6',
    unit: 'jar',
    brand: 'Addis Pantry',
    short: 'Ethiopian chili blend for doro wat and lentils.',
    description: 'Chili, fenugreek, korarima, and warm spices. Bloom it in oil before adding onions.',
    ingredients: 'Chili, fenugreek, coriander, ginger, garlic, salt.',
    dietary: ['halal', 'vegetarian', 'vegan', 'gluten_free', 'spicy'],
    attributes: { heatLevel: 'medium' },
    tags: ['pantry'],
    quantity: 30,
  },
  {
    name: 'Ground Crayfish',
    slug: 'ground-crayfish',
    sku: 'FISH-CRAYFISH',
    category: 'dried-fish-and-proteins',
    country: 'NG',
    region: 'west_africa',
    priceCents: 1199,
    storage: 'ambient',
    netOz: '4',
    shipOz: '6',
    unit: 'pack',
    brand: 'Calabar Coast',
    short: 'Finely ground dried crayfish for soups and stews.',
    description: 'Adds a savory, ocean flavor to egusi, edikaikong, and jollof.',
    ingredients: 'Dried crayfish.',
    allergens: ['shellfish'],
    dietary: ['gluten_free'],
    tags: ['soup'],
    quantity: 24,
  },
  {
    name: 'Stockfish Pieces',
    slug: 'stockfish-pieces',
    sku: 'FISH-STOCK',
    category: 'dried-fish-and-proteins',
    country: 'NO',
    region: 'west_africa',
    priceCents: 2499,
    storage: 'ambient',
    netOz: '8',
    shipOz: '10',
    unit: 'pack',
    brand: 'North Sea Cut',
    short: 'Dried cod pieces cut for Nigerian and Ghanaian soups.',
    description: 'Soak until flexible, then simmer in egusi, afang, or banga soup. This is the stockfish African grocers keep beside crayfish.',
    ingredients: 'Dried cod.',
    allergens: ['fish'],
    dietary: ['gluten_free', 'halal'],
    featured: true,
    tags: ['soup'],
    variants: [
      { sku: 'FISH-STOCK-8', title: '8 oz', size: '8 oz', priceCents: 2499, netOz: '8', shipOz: '10', quantity: 18 },
      { sku: 'FISH-STOCK-16', title: '16 oz', size: '16 oz', priceCents: 4499, netOz: '16', shipOz: '18', quantity: 10 },
    ],
  },
  {
    name: 'Smoked Dried Catfish',
    slug: 'smoked-dried-catfish',
    sku: 'FISH-CATFISH',
    category: 'dried-fish-and-proteins',
    country: 'NG',
    region: 'west_africa',
    priceCents: 1899,
    storage: 'ambient',
    netOz: '6',
    shipOz: '8',
    unit: 'pack',
    brand: 'Niger Delta Smokehouse',
    short: 'Hardwood-smoked catfish fillets, dried for the pantry.',
    description: 'Rinse, soak briefly, and add near the end of a soup so the smoke stays bright.',
    ingredients: 'Smoked catfish.',
    allergens: ['fish'],
    dietary: ['gluten_free', 'halal'],
    tags: ['soup', 'pepper-soup'],
    quantity: 16,
  },
  {
    name: 'Ground Egusi',
    slug: 'ground-egusi',
    sku: 'SEED-EGUSI',
    category: 'dried-fish-and-proteins',
    country: 'NG',
    region: 'west_africa',
    priceCents: 1099,
    storage: 'ambient',
    netOz: '16',
    shipOz: '18',
    unit: 'bag',
    brand: 'Benue Seed',
    short: 'Melon seed meal for egusi soup.',
    description: 'Already ground. Fry it in palm oil before adding stock so the soup thickens instead of seizing.',
    ingredients: 'Melon seed.',
    dietary: ['halal', 'vegetarian', 'vegan', 'gluten_free'],
    tags: ['soup'],
    variants: [
      { sku: 'SEED-EGUSI-1', title: '1 lb', size: '1 lb', priceCents: 1099, netOz: '16', shipOz: '18', quantity: 28 },
      { sku: 'SEED-EGUSI-2', title: '2 lb', size: '2 lb', priceCents: 1999, netOz: '32', shipOz: '34', quantity: 14 },
    ],
  },
  {
    name: 'Mackerel in Tomato Sauce',
    slug: 'mackerel-in-tomato-sauce',
    sku: 'CAN-MACKEREL',
    category: 'canned-and-jarred',
    country: 'GH',
    region: 'west_africa',
    priceCents: 349,
    storage: 'ambient',
    netOz: '15',
    shipOz: '17',
    unit: 'can',
    brand: 'Tema Cannery',
    short: 'Canned mackerel in tomato, ready for stew or rice.',
    description: 'A pantry tin for quick stews. Drain if you want a thicker sauce.',
    ingredients: 'Mackerel, tomato, salt, spices.',
    allergens: ['fish'],
    dietary: ['gluten_free', 'halal'],
    tags: ['pantry'],
    quantity: 48,
  },
  {
    name: 'Bitter Leaf in Brine',
    slug: 'bitter-leaf-in-brine',
    sku: 'JAR-BITTERLEAF',
    category: 'canned-and-jarred',
    country: 'NG',
    region: 'west_africa',
    priceCents: 799,
    storage: 'ambient',
    netOz: '16',
    shipOz: '24',
    unit: 'jar',
    brand: 'Enugu Kitchen',
    short: 'Washed bitter leaf packed in brine for ofe onugbu.',
    description: 'Rinse before use. The leaf is already washed down so the bitterness is moderate.',
    ingredients: 'Bitter leaf, water, salt.',
    dietary: ['halal', 'vegetarian', 'vegan', 'gluten_free'],
    tags: ['soup'],
    quantity: 20,
  },
  {
    name: 'Chin Chin',
    slug: 'chin-chin',
    sku: 'SNACK-CHINCHIN',
    category: 'snacks',
    country: 'NG',
    region: 'west_africa',
    priceCents: 599,
    storage: 'ambient',
    netOz: '8',
    shipOz: '10',
    unit: 'bag',
    brand: 'Lagos Sweet',
    short: 'Crunchy fried dough bites, lightly sweet.',
    description: 'A shareable snack with tea. Contains wheat.',
    ingredients: 'Wheat flour, sugar, nutmeg, oil, salt.',
    allergens: ['wheat'],
    dietary: ['vegetarian'],
    tags: ['snack'],
    quantity: 36,
  },
  {
    name: 'Plantain Chips',
    slug: 'plantain-chips',
    sku: 'SNACK-PLANTAIN',
    category: 'snacks',
    country: 'GH',
    region: 'west_africa',
    priceCents: 449,
    compareAtPriceCents: 549,
    storage: 'ambient',
    netOz: '5',
    shipOz: '7',
    unit: 'bag',
    brand: 'Accra Harvest',
    short: 'Salted ripe plantain chips.',
    description: 'Fried plantain slices with salt. No wheat.',
    ingredients: 'Plantain, palm olein, salt.',
    dietary: ['halal', 'vegetarian', 'vegan', 'gluten_free'],
    featured: true,
    tags: ['snack'],
    quantity: 40,
  },
  {
    name: 'Zobo Hibiscus Mix',
    slug: 'zobo-hibiscus-mix',
    sku: 'DRINK-ZOBO',
    category: 'drinks',
    country: 'NG',
    region: 'west_africa',
    priceCents: 699,
    storage: 'ambient',
    netOz: '6',
    shipOz: '8',
    unit: 'bag',
    brand: 'Kano Cooler',
    short: 'Dried hibiscus with ginger and pineapple for zobo.',
    description: 'Simmer, strain, and chill. This mix contains no sweetener, so add sugar or dates to taste.',
    ingredients: 'Hibiscus, ginger, pineapple, cloves.',
    dietary: ['halal', 'vegetarian', 'vegan', 'gluten_free'],
    tags: ['pantry'],
    quantity: 30,
  },
  {
    name: 'Malta Non-Alcoholic Malt Drink',
    slug: 'malta-malt-drink',
    sku: 'DRINK-MALTA',
    category: 'drinks',
    country: 'GH',
    region: 'west_africa',
    priceCents: 249,
    storage: 'ambient',
    netOz: '11.1',
    shipOz: '14',
    unit: 'bottle',
    brand: 'Tema Malt',
    short: 'A malt soda bottled for West African tables.',
    description: 'Serve cold. A malt soda bottled for West African tables.',
    ingredients: 'Carbonated water, malt extract, sugar, caramel color, hops.',
    allergens: ['wheat'],
    dietary: ['vegetarian', 'halal'],
    tags: ['pantry'],
    quantity: 48,
  },
  {
    name: 'Frozen Goat Stew Meat',
    slug: 'frozen-goat-stew-meat',
    sku: 'FROZ-GOAT',
    category: 'frozen',
    country: 'NG',
    region: 'west_africa',
    priceCents: 1899,
    storage: 'frozen',
    perishable: true,
    shelfLifeDays: 120,
    netOz: '16',
    shipOz: '18',
    unit: 'pack',
    brand: 'Kano Halal',
    short: 'Bone-in goat, cut for stew and pepper soup, kept frozen.',
    description: 'Ships with a cold pack. Keep frozen until the day you cook it. Halal processed.',
    ingredients: 'Goat.',
    dietary: ['halal', 'gluten_free'],
    featured: true,
    tags: ['soup', 'pepper-soup'],
    quantity: 12,
  },
  {
    name: 'Fresh Scotch Bonnet Peppers',
    slug: 'fresh-scotch-bonnet-peppers',
    sku: 'FRESH-BONNET',
    category: 'fresh',
    country: 'GH',
    region: 'west_africa',
    priceCents: 599,
    storage: 'refrigerated',
    perishable: true,
    shelfLifeDays: 10,
    netOz: '8',
    shipOz: '10',
    unit: 'pack',
    brand: 'Accra Harvest',
    short: 'Fresh scotch bonnets, packed when the week’s produce arrives.',
    description: 'Refrigerate on arrival. Very hot. Use gloves when cutting.',
    ingredients: 'Scotch bonnet peppers.',
    dietary: ['halal', 'vegetarian', 'vegan', 'gluten_free', 'spicy'],
    attributes: { heatLevel: 'hot' },
    tags: ['pepper-soup'],
    quantity: 14,
  },
  {
    name: 'African Black Soap Bar',
    slug: 'african-black-soap-bar',
    sku: 'HOME-SOAP',
    category: 'household',
    country: 'GH',
    region: 'west_africa',
    priceCents: 649,
    storage: 'ambient',
    netOz: '5',
    shipOz: '7',
    unit: 'each',
    brand: 'Cape Coast Press',
    short: 'Plantain-skin black soap, a household staple in West African groceries.',
    description: 'A simple bathing bar. Not a food. Keep it dry between uses.',
    ingredients: 'Plantain ash, palm kernel oil, cocoa pod, shea.',
    dietary: ['vegan'],
    tags: ['pantry'],
    quantity: 24,
  },
];

async function main(): Promise<void> {
  const passwordHash = await argon2.hash(env.SUPER_ADMIN_PASSWORD, { type: argon2.argon2id });
  await prisma.admin.upsert({
    where: { email: env.SUPER_ADMIN_EMAIL.toLowerCase() },
    update: { name: env.SUPER_ADMIN_NAME, role: 'SUPER_ADMIN', isActive: true },
    create: {
      email: env.SUPER_ADMIN_EMAIL.toLowerCase(),
      passwordHash,
      name: env.SUPER_ADMIN_NAME,
      role: 'SUPER_ADMIN',
    },
  });

  const categoryIds = new Map<string, string>();
  for (const [index, category] of categories.entries()) {
    const parentId = category.parent ? categoryIds.get(category.parent) : undefined;
    const row = await prisma.category.upsert({
      where: { slug: category.slug },
      update: {
        name: category.name,
        description: category.description,
        parentId: parentId ?? null,
        level: parentId ? 1 : 0,
        sortOrder: index,
        isActive: true,
      },
      create: {
        name: category.name,
        slug: category.slug,
        description: category.description,
        parentId: parentId ?? null,
        level: parentId ? 1 : 0,
        sortOrder: index,
        isActive: true,
        isFeatured: !parentId,
      },
    });
    categoryIds.set(category.slug, row.id);
  }

  for (const tag of tags) {
    await prisma.tag.upsert({ where: { slug: tag.slug }, update: { name: tag.name }, create: tag });
  }

  const shipping = shippingSettingsFromEnv(env);
  await prisma.siteSetting.upsert({
    where: { id: 'default' },
    update: {
      freeShippingThresholdCents: shipping.freeShippingThresholdCents,
      coldPackSurchargeCents: shipping.coldPackSurchargeCents,
      shippingRates: asJson(shipping.zones),
      taxFlatRateBps: env.TAX_FLAT_RATE_BPS,
    },
    create: {
      id: 'default',
      storeName: 'AfriBasket',
      supportEmail: env.ADMIN_ALERT_EMAIL,
      supportPhone: '+12025550100',
      freeShippingThresholdCents: shipping.freeShippingThresholdCents,
      coldPackSurchargeCents: shipping.coldPackSurchargeCents,
      announcementBar: 'African groceries delivered across the United States. Free shipping on orders of $75 or more.',
      socialLinks: {},
      defaultMetaTitle: 'AfriBasket',
      defaultMetaDescription: 'African groceries delivered across the United States.',
      shippingRates: asJson(shipping.zones),
      taxFlatRateBps: env.TAX_FLAT_RATE_BPS,
    },
  });

  for (const product of products) {
    const categoryId = categoryIds.get(product.category);
    if (!categoryId) throw new Error(`Missing category ${product.category}`);
    const imageUrl = `https://placehold.co/800x800/1c1917/f5f5f4/png?text=${encodeURIComponent(product.name)}`;
    const saved = await prisma.product.upsert({
      where: { slug: product.slug },
      update: {
        name: product.name,
        shortDescription: product.short,
        description: product.description,
        brand: product.brand,
        countryOfOrigin: product.country,
        region: product.region,
        priceCents: product.priceCents,
        compareAtPriceCents: product.compareAtPriceCents ?? null,
        storageType: product.storage,
        perishable: product.perishable ?? false,
        shelfLifeDays: product.shelfLifeDays ?? null,
        netWeightOz: new Prisma.Decimal(product.netOz),
        shippingWeightOz: new Prisma.Decimal(product.shipOz),
        unitLabel: product.unit,
        ingredients: product.ingredients,
        allergenFlags: product.allergens ?? [],
        dietaryTags: product.dietary ?? [],
        attributes: product.attributes ?? Prisma.JsonNull,
        isFeatured: product.featured ?? false,
        isActive: true,
        status: 'available',
        categoryId,
        metaTitle: `${product.name} | AfriBasket`,
        metaDescription: product.short,
      },
      create: {
        name: product.name,
        slug: product.slug,
        sku: product.sku,
        shortDescription: product.short,
        description: product.description,
        brand: product.brand,
        countryOfOrigin: product.country,
        region: product.region,
        priceCents: product.priceCents,
        compareAtPriceCents: product.compareAtPriceCents,
        storageType: product.storage,
        perishable: product.perishable ?? false,
        shelfLifeDays: product.shelfLifeDays,
        netWeightOz: new Prisma.Decimal(product.netOz),
        shippingWeightOz: new Prisma.Decimal(product.shipOz),
        unitLabel: product.unit,
        ingredients: product.ingredients,
        allergenFlags: product.allergens ?? [],
        dietaryTags: product.dietary ?? [],
        attributes: product.attributes ?? undefined,
        isFeatured: product.featured ?? false,
        categoryId,
        metaTitle: `${product.name} | AfriBasket`,
        metaDescription: product.short,
      },
    });

    const tagRows = await prisma.tag.findMany({ where: { slug: { in: product.tags } } });
    await prisma.productTag.deleteMany({ where: { productId: saved.id } });
    if (tagRows.length) {
      await prisma.productTag.createMany({ data: tagRows.map((tag) => ({ productId: saved.id, tagId: tag.id })) });
    }

    const images = await prisma.productImage.count({ where: { productId: saved.id } });
    if (images === 0) {
      await prisma.productImage.create({
        data: { productId: saved.id, url: imageUrl, publicId: `seed/${product.slug}`, altText: product.name, isPrimary: true, sortOrder: 0 },
      });
    }

    if (product.variants?.length) {
      await prisma.inventory.deleteMany({ where: { productId: saved.id, quantityAvailable: 0, quantityReserved: 0 } });
      for (const variant of product.variants) {
        const row = await prisma.productVariant.upsert({
          where: { sku: variant.sku },
          update: {
            title: variant.title,
            options: { size: variant.size },
            priceCents: variant.priceCents,
            netWeightOz: new Prisma.Decimal(variant.netOz),
            shippingWeightOz: new Prisma.Decimal(variant.shipOz),
            isActive: true,
          },
          create: {
            productId: saved.id,
            sku: variant.sku,
            title: variant.title,
            options: { size: variant.size },
            priceCents: variant.priceCents,
            netWeightOz: new Prisma.Decimal(variant.netOz),
            shippingWeightOz: new Prisma.Decimal(variant.shipOz),
            quantityAvailable: variant.quantity,
            lowStockThreshold: 4,
            reorderPoint: 8,
            reorderQuantity: 24,
          },
        });
        if (product.perishable || product.storage === 'frozen') {
          const existing = await prisma.foodLot.count({ where: { variantId: row.id } });
          if (existing === 0) {
            await prisma.foodLot.create({
              data: {
                productId: saved.id,
                variantId: row.id,
                lotCode: `${variant.sku}-A`,
                quantity: variant.quantity,
                bestByDate: new Date(Date.now() + (product.shelfLifeDays ?? 90) * 86400000),
                receivedAt: new Date(),
              },
            });
          }
        }
      }
    } else {
      const inventory = await prisma.inventory.findUnique({ where: { productId: saved.id } });
      if (!inventory) {
        await prisma.inventory.create({
          data: {
            productId: saved.id,
            quantityAvailable: product.quantity ?? 0,
            lowStockThreshold: 4,
            reorderPoint: 8,
            reorderQuantity: 24,
            warehouseLocation: 'A-01',
          },
        });
      }
      if (product.perishable || product.storage === 'frozen') {
        const existing = await prisma.foodLot.count({ where: { productId: saved.id, variantId: null } });
        if (existing === 0) {
          const days = product.slug === 'fresh-scotch-bonnet-peppers' ? 10 : (product.shelfLifeDays ?? 90);
          await prisma.foodLot.create({
            data: {
              productId: saved.id,
              lotCode: `${product.sku}-A`,
              quantity: product.quantity ?? 0,
              bestByDate: new Date(Date.now() + days * 86400000),
              receivedAt: new Date(),
            },
          });
        }
      }
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
