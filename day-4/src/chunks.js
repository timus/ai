/**
 * chunks.js — Convert a property listing into a single text chunk.
 *
 * One chunk per property. Why not split further?
 * A property is a single, coherent unit of information — splitting it
 * (e.g. one chunk for price, one for description) would break semantic
 * search: "3 bedroom house with pool under $900k" needs ALL fields
 * together to find a match.
 *
 * Chunk granularity is a RAG design decision.
 * For property search: 1 listing = 1 chunk is the right choice.
 * For document Q&A (e.g. a 100-page PDF): 1 paragraph = 1 chunk.
 */

/**
 * Convert a listing object into a text chunk for embedding.
 * Returns { id, text, metadata } where metadata holds structured fields
 * for post-retrieval filtering (beds, price, suburb).
 */
export function chunkListing(listing) {
  const parts = [];

  // Address line
  const unit   = listing.unit ? `${listing.unit}/` : '';
  const address = `${unit}${listing.streetNum} ${listing.street}, ${listing.suburb} ${listing.state} ${listing.postcode}`.trim();
  parts.push(address);

  // Property summary line
  const details = [
    `${listing.beds} bed`,
    `${listing.baths} bath`,
    listing.cars ? `${listing.cars} car` : null,
    listing.type,
    listing.landArea ? `Land ${listing.landArea}${listing.landUnit}` : null,
  ].filter(Boolean).join(' | ');
  parts.push(details);

  // Status + Price
  const status = listing.listingType === 'Sold' ? 'SOLD' : 'FOR SALE';
  const priceLabel = listing.displayPrice ? `${status}: ${listing.displayPrice}` : status;
  parts.push(priceLabel);

  // Auction/inspection
  if (listing.auctionDate) {
    parts.push(`Auction: ${listing.auctionDate}`);
  }
  if (listing.inspections?.length) {
    parts.push(`Inspections: ${listing.inspections.join(', ')}`);
  }

  // Features
  if (listing.features?.length) {
    parts.push(`Features: ${listing.features.join(', ')}`);
  }

  // Headline + description
  if (listing.headline) {
    parts.push(listing.headline);
  }
  if (listing.description) {
    parts.push(listing.description.slice(0, 500));
  }

  return {
    id:   String(listing.id),
    text: parts.filter(Boolean).join('\n'),
    metadata: {
      id:           listing.id,
      address,
      suburb:       listing.suburb,
      state:        listing.state,
      postcode:     listing.postcode,
      type:         listing.type,
      beds:         listing.beds,
      baths:        listing.baths,
      cars:         listing.cars,
      landArea:     listing.landArea,
      listingType:  listing.listingType,
      priceFrom:    listing.priceFrom,
      priceTo:      listing.priceTo,
      displayPrice: listing.displayPrice,
      url:          listing.url,
      auctionDate:  listing.auctionDate,
      inspections:  listing.inspections,
    },
  };
}

export function chunkListings(listings) {
  return listings.map(chunkListing);
}
