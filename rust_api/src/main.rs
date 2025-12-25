use axum::{
    routing::get,
    Router,
    http::StatusCode,
    response::Json,
    extract::{Query, State},
};
use reqwest::Client;
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::cors::{CorsLayer, Any};

#[derive(Deserialize)]
struct SearchParams {
    q: String,
}

#[derive(Deserialize)]
struct AllParams {
    #[serde(default)]
    addon: Option<String>,
}

#[derive(Clone)]
struct AppState {
    cache: Arc<RwLock<Option<Value>>>,
}

#[tokio::main]
async fn main() {
    let cache: Arc<RwLock<Option<Value>>> = Arc::new(RwLock::new(None));
    let cache_clone = cache.clone();
    
    // Spawn task to fetch and cache all data
    tokio::spawn(async move {
        let client = Client::new();
        // Request with specific addons filter
        let addons = "Skript,SkBee,skript-reflect,skript-gui,skNoise,skript-particle";
        let url = format!(
            "https://api.skdocs.org/api/search?q=ALL_ADDON_SYNTAXES&addon={}",
            addons
        );
        
        loop {
            if let Ok(resp) = client.get(&url).send().await {
                if let Ok(json) = resp.json::<Value>().await {
                    *cache_clone.write().await = Some(json);
                    println!("Cache updated successfully with filtered addons");
                    break;
                }
            }
            println!("Failed to fetch data, retrying in 5s...");
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
        }
    });
    
    let state = AppState { cache };
    
    // Configure CORS to allow requests from anywhere
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);
    
    let app = Router::new()
        .route("/all", get(serve_all))
        .route("/search", get(search))
        .with_state(state)
        .layer(cors);
    
    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let addr = format!("0.0.0.0:{}", port);

    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Failed to bind to {}: {}", addr, e);
            return;
        }
    };

    println!("Server running on http://0.0.0.0:{}", port);
    
    axum::serve(listener, app).await.unwrap();
}

async fn serve_all(
    State(state): State<AppState>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let read = state.cache.read().await;
    if let Some(json) = &*read {
        Ok(Json(json.clone()))
    } else {
        Err((StatusCode::SERVICE_UNAVAILABLE, "Cache not ready yet".to_string()))
    }
}

async fn search(
    Query(params): Query<SearchParams>,
    State(state): State<AppState>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let read = state.cache.read().await;
    
    if let Some(data) = &*read {
        // Assuming the API returns { "results": [...] }
        let results = data.get("results")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        
        let filtered: Vec<Value> = results.into_iter()
            .filter(|item| {
                // Search in multiple fields
                let query_lower = params.q.to_lowercase();
                
                let matches_title = item.get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_lowercase().contains(&query_lower))
                    .unwrap_or(false);
                
                let matches_syntax = item.get("syntax")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_lowercase().contains(&query_lower))
                    .unwrap_or(false);
                
                let matches_category = item.get("category")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_lowercase().contains(&query_lower))
                    .unwrap_or(false);
                
                matches_title || matches_syntax || matches_category
            })
            .collect();
        
        Ok(Json(serde_json::json!({
            "results": filtered,
            "count": filtered.len()
        })))
    } else {
        Err((StatusCode::SERVICE_UNAVAILABLE, "Cache not ready yet".to_string()))
    }
}