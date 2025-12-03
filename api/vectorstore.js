export const vectorStore = {
    similaritySearch: async (query, k = 4, options = {}) => {
        console.log("📡 [VectorStore] Buscando:", query);
        console.log("🔍 [VectorStore] Filtros aplicados:", options.filter);
        
        return []; 
    }
};