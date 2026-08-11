
const Paginate = (totalItems, limit, page) => {
    
  const paginatorLength = 7;
  //CALCULO CANTIDAD DE PAGINAS
  const totalPages = Math.ceil(totalItems / limit);
  if(page < 1){page = 1;}
  if(page > totalPages){page = totalPages;}

  let hasNextPage = false;
  let hasPrevPage = false;
  let firstPageSection = null;
  let lastPageSection = null;
  let nextSection = null;
  let backSection = null;
  let arrPages = [];
  if(totalPages > 1){
    if(totalPages > paginatorLength){
      const advance = parseInt(paginatorLength / 2);

      if(page == totalPages){
        firstPageSection = page - paginatorLength + 1;
      }		
      else{
        if(page > advance){firstPageSection = page - advance;} 	
        else{firstPageSection = 1;}
      }

      lastPageSection = firstPageSection + paginatorLength - 1;
      if(lastPageSection > totalPages){
        lastPageSection = totalPages;
      }

      const nextSectionFirstPage = lastPageSection + 1;
      if ((nextSectionFirstPage) <= totalPages) {
        nextSection = nextSectionFirstPage;
      }
      if(firstPageSection > 1){
        backSection =  firstPageSection - 1;
      }
    }
    else{
      firstPageSection = 1;
      lastPageSection = totalPages;
    }

    for(let i = firstPageSection; i <= lastPageSection; i++){
      arrPages.push(i);
    }

    if (page == 1){
      hasPrevPage = false;
    } 
    else{
      hasPrevPage = true;
    }

    if(totalPages > page){
      hasNextPage = true;
    }
    else{
      hasNextPage = false;
    }
  }

  let nextPage = null
  if(hasNextPage) nextPage = page + 1;
  let prevPage = null
  if(hasPrevPage) prevPage = page - 1;

  let startItemPage = ((page - 1) * limit) + 1;
  let endItemPage = (page * limit);
  if(!hasNextPage) endItemPage = totalItems;

  return  {
    "totalItems": totalItems,
    "limit": limit,
    "page": page,
    "totalPages": totalPages,
    "pagesSection": arrPages,
    "backSection": backSection,
    "nextSection": nextSection,
    "startItemPage": startItemPage,
    "endItemPage": endItemPage,
    "hasNextPage": hasNextPage,
    "hasPrevPage": hasPrevPage,
    "nextPage": nextPage,
    "prevPage": prevPage
  }
};

export default Paginate;